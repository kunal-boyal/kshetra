import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  AnnouncementBody,
  AnnouncementQuery,
  ConsoleAnnouncement,
  ConsoleAnnouncementList,
  IdParams,
  TenantAnnouncementList,
} from '@thelamp/shared';
import {
  type Access,
  CurrentAccess,
  CurrentStaff,
  ForStaff,
  SignedIn,
  type StaffAccess,
} from '../../platform/auth';
import { Contract } from '../../platform/routes';
import { AnnouncementsService } from './announcements.service';

/**
 * Announcements in the platform console (module M22, decision D93): any staff member reads them;
 * those who manage tenants write and withdraw them.
 */
@Controller('platform/v1/announcements')
export class AnnouncementsConsoleController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @ForStaff()
  @Get()
  @Contract({
    tag: 'Platform console',
    summary: 'List announcements',
    response: ConsoleAnnouncementList,
  })
  async list() {
    return { items: await this.announcements.list() };
  }

  @ForStaff('platform.tenant.manage')
  @Post()
  @Contract({
    tag: 'Platform console',
    summary: 'Announce something to tenants',
    body: AnnouncementBody,
    response: ConsoleAnnouncement,
  })
  create(@CurrentStaff() staff: StaffAccess, @Body() body: unknown) {
    return this.announcements.create(staff, AnnouncementBody.parse(body));
  }

  @ForStaff('platform.tenant.manage')
  @Post(':id/withdraw')
  @HttpCode(200)
  @Contract({
    tag: 'Platform console',
    summary: 'Take an announcement down',
    params: IdParams,
    response: ConsoleAnnouncement,
  })
  withdraw(@CurrentStaff() staff: StaffAccess, @Param() params: unknown) {
    return this.announcements.withdraw(staff, IdParams.parse(params).id);
  }
}

/** What the vendor is telling the caller's organisation now, on the web or the phone. */
@Controller('v1/announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @SignedIn()
  @Get()
  @Contract({
    tag: 'Notifications',
    summary: 'What the vendor is announcing now',
    query: AnnouncementQuery,
    response: TenantAnnouncementList,
  })
  async current(@CurrentAccess() access: Access, @Query() query: unknown) {
    const { surface } = AnnouncementQuery.parse(query);
    return { items: await this.announcements.current(access.tenantId, surface) };
  }
}
