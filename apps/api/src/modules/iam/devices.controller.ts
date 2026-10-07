import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { DeviceHeartbeatBody } from '@kshetra/shared';
import { type Access, CurrentAccess, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { DevicesService } from './devices.service';

/** The phone's own reports (spec 11.2, Me and config group). */
@Controller('v1/devices')
export class DevicesController {
  constructor(
    private readonly database: Database,
    private readonly devices: DevicesService,
  ) {}

  @Post('heartbeat')
  @HttpCode(204)
  @Contract({
    tag: 'Devices',
    summary: "Report the phone's health: permissions, battery optimisation and upload queue",
    body: DeviceHeartbeatBody,
    headers: [{ name: 'X-Device-Time', description: "The phone's clock, for its skew (BR-44)" }],
  })
  @SignedIn()
  async heartbeat(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('x-device-time') deviceTime: string | undefined,
  ): Promise<void> {
    const input = DeviceHeartbeatBody.parse(body);
    await this.database.forTenant(access.tenantId, (tx) =>
      this.devices.heartbeat(tx, access, input, deviceTime),
    );
  }
}
