import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { UserEntity } from '../database/entities/user.entity';
import { JwtPayload } from '../security/jwt-auth.guard';

// Compared against when the username is unknown so response time doesn't reveal which usernames exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly jwt: JwtService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.users.findOne({
      where: { username: username.trim().toLowerCase() },
    });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok)
      throw new UnauthorizedException('Invalid username or password');

    const payload: JwtPayload = {
      sub: user.id,
      name: user.displayName,
      role: user.role,
    };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: this.toPublic(user),
    };
  }

  async me(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User no longer exists');
    return this.toPublic(user);
  }

  private toPublic(u: UserEntity) {
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
    };
  }
}
