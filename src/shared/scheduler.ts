export type SchedulerRecurrenceType='once'|'daily'|'weekdays'|'weekly'|'monthly'|'interval';
export type SchedulerModule='qa'|'proxy'|'streaming'|'social'|'devices'|'system';
export type SchedulerAction='qa-rerun'|'proxy-check-all'|'proxy-recheck-dead'|'streaming-account-verify'|'streaming-refresh-library'|'social-account-verify'|'mobile-launch-avd'|'real-ios-check'|'browser-runtime-check';
export interface SchedulerRecurrence {type:SchedulerRecurrenceType;startAt?:string|null;time?:string;daysOfWeek?:number[];dayOfMonth?:number;intervalMinutes?:number;}
export interface SchedulerTask {id:string;name:string;module:SchedulerModule;action:SchedulerAction;targetId?:string|null;targetLabel?:string;enabled:boolean;schedule:SchedulerRecurrence;nextRunAt?:string|null;lastRunAt?:string;lastStatus?:'success'|'failed';lastMessage?:string;runCount?:number;createdAt:string;updatedAt:string;}
export interface SchedulerTaskDraft {id?:string;name:string;module:SchedulerModule;action:SchedulerAction;targetId?:string|null;targetLabel?:string;enabled?:boolean;schedule:SchedulerRecurrence;}
