import { Body, Controller, Get, Post } from '@nestjs/common';
import { StatutoryRateSet, StatutoryRatesResult, StatutoryReviewBody } from '@thelamp/shared';
import { CurrentStaff, ForStaff, type StaffAccess } from '../../platform/auth';
import { Contract } from '../../platform/routes';
import { StatutoryRatesService } from './statutory-rates.service';

/**
 * Statutory payroll's rates in the platform console (decision D128): the dated rate sets every
 * cell works payslips out on, and the chartered accountant's reviews that lift the label. Any
 * staff member reads them; adding needs `platform.billing.manage`.
 */
@Controller('platform/v1/statutory-rates')
export class StatutoryRatesController {
  constructor(private readonly rates: StatutoryRatesService) {}

  @ForStaff()
  @Get()
  @Contract({
    tag: 'Platform console',
    summary: 'The statutory rate sets in force over time, with their reviews',
    response: StatutoryRatesResult,
  })
  read() {
    return this.rates.result();
  }

  @ForStaff('platform.billing.manage')
  @Post()
  @Contract({
    tag: 'Platform console',
    summary: 'Add a statutory rate set from a date; sets already used never change',
    body: StatutoryRateSet,
    response: StatutoryRatesResult,
  })
  async add(@CurrentStaff() staff: StaffAccess, @Body() body: unknown) {
    await this.rates.addSet(staff, StatutoryRateSet.parse(body));
    return this.rates.result();
  }

  @ForStaff('platform.billing.manage')
  @Post('reviews')
  @Contract({
    tag: 'Platform console',
    summary: 'Record a chartered accountant’s review of a rate set under the rules’ version',
    body: StatutoryReviewBody,
    response: StatutoryRatesResult,
  })
  async review(@CurrentStaff() staff: StaffAccess, @Body() body: unknown) {
    await this.rates.recordReview(staff, StatutoryReviewBody.parse(body));
    return this.rates.result();
  }
}
