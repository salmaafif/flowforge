import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import { LoginResult } from './auth.types';
import { LoginDto, loginSchema } from './dto/login.dto';
import { Public } from './decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body(new ZodValidationPipe(loginSchema)) credentials: LoginDto): Promise<LoginResult> {
    return this.authService.login(credentials);
  }
}
