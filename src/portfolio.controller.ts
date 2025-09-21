import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import axios from "axios";
import z from "zod";
import { requireUser } from "./auth.util";

const prisma = new PrismaClient();

const AddHoldingDto = z.object({
    symbol: z.string().toLowerCase().min(2).max(40),
    amount: z.coerce.number().positive(),
})

// price cache
const priceCache: Record<string, { usd: number; ts: number }> = {};
const PRICE_TTL_MS = 60_000;

// 24h market cache
type Market24h = { series: number[]; changePct: number };
const marketCache: Record<string, { data: Market24h; ts: number }> = {};
const MKT_TTL_MS = 60_000;

async function getPrices(symbols: string[]) {
    const now = Date.now();
    const missing = symbols.filter(s => !(s in priceCache) || now - priceCache[s].ts > PRICE_TTL_MS);

    if (missing.length) {
        const { data } = await axios.get(
            'https://api.coingecko.com/api/v3/simple/price',
            { params: { ids: missing.join(','), vs_currencies: 'usd' } }
        );
        for (const id of missing) {
            const usd = data?.[id]?.usd ?? 0;
            priceCache[id] = { usd, ts: now };
        }
    }

    const result: Record<string, number> = {};
    for (const s of symbols) result[s] = priceCache[s]?.usd ?? 0;
    return result;
}

async function get24hMarket(symbols: string[]): Promise<Record<string, Market24h>> {
    const now = Date.now();
    const result: Record<string, Market24h> = {};

    const tasks = symbols.map(async (id) => {
        const cached = marketCache[id];
        if (cached && now - cached.ts <= MKT_TTL_MS) {
            result[id] = cached.data;
            return;
        }
        const { data } = await axios.get(
            `https://api.coingecko.com/api/v3/coins/${id}/market_chart`,
            { params: { vs_currency: 'usd', days: 1 } }
        );
        const raw = Array.isArray(data?.prices) ? data.prices.map((p: [number, number]) => p[1]) : [];
        const target = 30;
        const step = Math.max(1, Math.floor(raw.length / target));
        const series = raw.filter((_, i) => i % step === 0);
        const first = series[0] ?? 0;
        const last = series.at(-1) ?? 0;
        const changePct = first ? ((last - first) / first) * 100 : 0;

        const payload: Market24h = { series, changePct };
        marketCache[id] = { data: payload, ts: now };
        result[id] = payload;
    });

    await Promise.all(tasks);
    return result;
}

@Controller('portfolio')
export class PortfolioController {
    @Get('me')
    async me(@Req() req: any) {
        const { uid } = requireUser(req);

        const holdings = await prisma.holding.findMany({ where: { userId: uid } });

        const bySymbol = new Map<string, number>();
        for (const h of holdings) {
            const s = h.symbol.toLowerCase();
            const current = bySymbol.get(s) ?? 0;
            bySymbol.set(s, current + Number(h.amount));
        }
        const ids = Array.from(new Set(holdings.map(h => h.symbol.toLowerCase())))
        if (!ids.length) return { ok: true, total: 0, rows: [] };

        const [prices, market] = await Promise.all([getPrices(ids), get24hMarket(ids)]);
        const rows = ids.map(id => {
            const amount = bySymbol.get(id) ?? 0;
            const price = prices[id] ?? 0;
            const value = amount * price;
            const m = market[id] ?? { series: [], changePct: 0 };
            return {
                symbol: id.toUpperCase(),
                id,
                amount,
                price,
                value,
                series: m.series,
                change: m.changePct,
            };
        });

        const total = rows.reduce((a, r) => a + r.value, 0);
        return { ok: true, total, rows };
    }

    @Post('holdings')
    async add(@Req() req: any, @Body() body: unknown) {
        const { uid } = requireUser(req);
        const { symbol, amount } = AddHoldingDto.parse(body);

        const user = await prisma.user.findUnique({ where: { id: uid } });
        if (!user) return { ok: false };

        await prisma.holding.create({
            data: { userId: uid, symbol, amount },
        });

        return { ok: true };
    }
}