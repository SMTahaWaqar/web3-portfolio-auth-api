import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { PortfolioController } from './portfolio.controller';

@Module({
  controllers: [AuthController, PortfolioController],
  providers: [],
})
export class AppModule {}
