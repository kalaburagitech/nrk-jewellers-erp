import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Settings → General → Auto Backup. Checks daily; each company backs up every N days.
crons.daily("auto backup", { hourUTC: 21, minuteUTC: 30 }, internal.autoBackup.run, {}); // 3:00 AM IST

export default crons;
