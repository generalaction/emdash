export type CronPeriod = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

export interface CronState {
  period: CronPeriod;
  /** 0-59 */
  minute: number;
  /** 0-23 */
  hour: number;
  /** 1-31 */
  monthDay: number;
  /** 1-12 */
  month: number;
  /** 0-6, Sunday = 0 */
  weekDay: number;
}
