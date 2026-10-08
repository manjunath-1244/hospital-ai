import {
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { AuthUser, CurrentUser } from '../../security/auth-user';

@Controller('hospital/notifications')
export class NotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  async getMyNotifications(
    @CurrentUser() user: AuthUser,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    const userId = user.userId || (user as any).id;
    const isUnreadOnly = unreadOnly === 'true' || unreadOnly === '1';
    const items = await this.notificationService.getUserNotifications(
      userId,
      isUnreadOnly,
    );
    return { success: true, count: items.length, notifications: items };
  }

  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: AuthUser) {
    const userId = user.userId || (user as any).id;
    const unreadCount = await this.notificationService.getUnreadCount(userId);
    return { success: true, unreadCount };
  }

  @Post(':id/read')
  async markRead(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    const userId = user.userId || (user as any).id;
    const notif = await this.notificationService.markAsRead(id, userId);
    return { success: true, notification: notif };
  }

  @Post('read-all')
  async markAllRead(@CurrentUser() user: AuthUser) {
    const userId = user.userId || (user as any).id;
    const result = await this.notificationService.markAllAsRead(userId);
    return { success: true, updatedCount: result.count };
  }
}
