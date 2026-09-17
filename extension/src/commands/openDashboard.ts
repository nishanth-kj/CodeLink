import type { AppContext } from "../extension.js";
import { DashboardPanel } from "../ui/dashboard.js";

export function openDashboard(ctx: AppContext): void {
  DashboardPanel.show(ctx);
}
