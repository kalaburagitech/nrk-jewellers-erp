/**
 * One formal look for every billing / entry screen (New Bill, New Purchase,
 * quotations, orders, returns): plain bordered panels in the app theme
 * colours and an item table that fits the screen.
 */
export const panel = "overflow-hidden rounded-md border border-input bg-card";
export const panelHead =
  "flex items-center gap-2 border-b border-input bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-foreground";
export const formRow = "grid grid-cols-[84px_1fr] items-center gap-2";
export const formLabel = "text-xs font-medium text-muted-foreground";
export const thCls =
  "border-r border-b border-input px-1 py-1.5 text-center text-[11px] font-semibold leading-tight text-foreground last:border-r-0";
export const tdCls = "border-r border-input px-1 py-1 align-top last:border-r-0";
export const tblInput = "h-8 px-1.5 text-sm";
export const itemTable = "w-full min-w-[720px] table-fixed border-collapse text-sm lg:min-w-0";
export const itemHead = "sticky top-0 z-10 bg-muted";
export const itemRow = "border-b border-input bg-card hover:bg-muted/30";
