import { Body, Controller, Post, Res } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { verifyMessage } from 'ethers';
import { Response } from 'express';
import z from 'zod';
import * as jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

const VerifyDto = z.object({
    address: z.string().transform(a => a.toLowerCase()),
    message: z.string().min(1),
    signature: z.string().min(1),
});

function cookieFlags() {
    const isProd = process.env.NODE_ENV === 'production';
    return {
        httpOnly: true as const,
        secure: isProd,
        sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    };
}

@Controller('auth')
export class AuthController {
    @Post('verify')
    async verify(@Body() body: unknown, @Res() res: Response) {
        const { address, message, signature } = VerifyDto.parse(body);

        const recovered = verifyMessage(message, signature).toLowerCase();
        if (recovered !== address) return res.status(401).json({ ok: false, error: 'bad_sig' });

        const user = await prisma.user.upsert({
            where: { address },
            update: {},
            create: { address },
        });

        const token = jwt.sign(
            { uid: user.id, role: user.role },
            process.env.JWT_SECRET!,
            { expiresIn: '2d' }
        );

        res.cookie('session', token, { ...cookieFlags(), maxAge: 2 * 24 * 3600 * 1000 });
        return res.json({ ok: true });
    }

    @Post('logout')
    async logout(@Res() res: Response) {
        res.clearCookie('session', cookieFlags());
        return res.json({ ok: true });
    }
}