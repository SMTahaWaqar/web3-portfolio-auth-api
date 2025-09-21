import * as jwt from 'jsonwebtoken';

export const requireUser = (req: any) => {
    const token = req.cookies?.session;
    if (!token) throw new Error('Unauthorized');
    return jwt.verify(token, process.env.JWT_SECRET!) as { uid: string; role: string };
}