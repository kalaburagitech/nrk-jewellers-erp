# Vyapar Desktop: Functional Parity Spec

Research date: 2026-11-16. Sources are Vyapar's public guides and blog plus reputable listings. Vyapar's help center is JS-rendered and thin on detail. Anything not confirmed by a cited page is marked **unverified**. Unverified items reflect commonly seen in-app layouts and must be checked against the shop's installed copy before we copy them.

Key sources (cited below by tag):
- [FL] Complete feature list: https://vyaparapp.in/blog/vyapar-app-complete-feature-list-all-about-your-favorite-billing-software/
- [TR] Transaction reports guide: https://vyaparapp.in/guides/how-to-check-transaction-reports-in-vyapar-app
- [PL] P&L guide: https://vyaparapp.in/guides/how-to-check-profit-and-loss-report-in-vyapar
- [PLB] P&L blog: https://vyaparapp.in/blog/profit-and-loss-statement-in-vyapar/
- [BS] Balance Sheet guide: https://vyaparapp.in/guides/how-to-check-your-balance-sheet-in-vyapar
- [STK] Stock guide: https://vyaparapp.in/guides/how-to-manage-stock-inventory-in-vyapar
- [GD] Godowns: https://vyaparapp.in/guides/how-to-add-and-manage-godowns-in-vyapar
- [BAT] Batch/serial: https://vyaparapp.in/guides/how-to-add-item-batches-serial-numbers-in-vyapar
- [GST] GST calc: https://vyaparapp.in/guides/how-automatic-gst-and-tax-calculation-works-in-vyapar ; GST compliance: https://vyaparapp.in/guides/how-to-manage-gst-compliance-and-taxation-in-vyapar-app
- [DSC] Discounts: https://vyaparapp.in/guides/how-to-add-discounts-in-vyapar
- [PRN] Invoice customisation: https://vyaparapp.in/guides/how-to-customize-your-invoice-in-vyapar
- [EXP] Expenses: https://vyaparapp.in/guides/how-to-add-and-manage-expenses-in-vyapar-app
- [OI] Other income: https://vyaparapp.in/guides/how-to-add-other-income-in-vyapar
- [JE] Journal entries: https://vyaparapp.in/guides/how-to-add-journal-entries-in-vyapar
- [BANK] Bank setup: https://vyaparapp.in/guides/how-to-set-up-bank-details-and-payment-integration-in-vyapar
- [SYNC] Multi-device: https://vyaparapp.in/guides/how-to-use-vyapar-app-on-multiple-devices
- [MSG] Transaction messages: https://vyaparapp.in/guides/how-to-enable-and-send-transaction-messages-in-vyapar
- [REM] Payment reminders: https://vyaparapp.in/guides/how-to-send-payment-reminders-in-vyapar
- [JW] Jewellery page: https://vyaparapp.in/free/billing-software-for-retail-shop/jewellery-shop
- [LS] Low stock: https://vyaparapp.in/guides/how-to-set-a-low-stock-alert-in-vyapar

---

## 1. Module / menu map

Left menu [FL], [JE], [GD]:
- **Home / Dashboard**: cash in hand, stock value, bank balance, receivable/payable, sale graph.
- **Parties**: list with balances. Detail pane shows transactions with the party. Add/Edit party. Party groups.
- **Items**: Products / Services / Category / Units tabs (tab set **unverified**). Item detail shows a running sale/purchase history plus **Adjust Stock** [STK]. **Godown Management → Stock Transfer** [GD].
- **Sale**: Sale Invoices, Estimate/Quotation, Payment-In, Sale Order, Delivery Challan, Sale Return/Credit Note, and Other Income (when enabled) [FL], [OI]. POS mode is also offered.
- **Purchase & Expense**: Purchase Bills, Payment-Out, Expenses, Purchase Order, Purchase Return/Debit Note [FL].
- **Cash & Bank**: Bank Accounts, Cash in Hand, Cheques, Loan Accounts [FL].
- **Accounting**: appears only when Settings → Accounting → "Enable Accounting module" is on. It holds Journal Entry and ledgers [JE]. A Chart of Accounts screen is **unverified**.
- **Reports**: see §2.
- **Sync, Share & Backup**: multi-device sync with user roles [SYNC]. Auto backup (Google Drive), local/email backup, restore [FL].
- **Utilities**: import items/parties (Excel), export, data verification, year-end closing, message status, calculator, recycle bin [FL], [TR]. Barcode generator [JW].
- **My Online Store**: catalog link, and orders convert to sales [FL].
- **Settings**: General, Transaction, Invoice Print, Taxes & GST, Accounting, User Management, Transaction SMS/Message, Payment Reminder, Party, Item [FL], [JE].

---

## 2. Reports

General rules [TR]:
- Only saved, non-deleted transactions are counted. Deleted ones go to Utilities → Recycle Bin.
- Columns cannot be toggled. Filter first, then export.
- Every report has Excel (xls) export and Print/PDF.
- Common filters: period (This Month / Quarter / Year / Custom "Between"), Firm, Godown.

### 2.1 Transaction reports [TR], [FL]

| Report | Purpose / filters / columns | Calculation |
|---|---|---|
| Sale | Sale invoices for the period. Filters: period, party, firm, godown. Columns: Date, Inv No, Party, Txn type, Payment type, Total, Received, Balance. Graph view. | Totals = Σ invoice total. Received = Σ amount paid. Balance = Total − Received. |
| Purchase | Same layout for purchase bills: Paid and Balance (payable). | Same, using Paid. |
| Day Book | Every entry on one date. Filters: date, firm, godown. Columns: Name, Ref No, Txn Type, Total, Money In, Money Out, payment mode. | Net = Σ money in − Σ money out for the day. |
| All Transactions | Master list for the period. Filters: txn type, firm, godown. Columns: Date, Ref, Party, Category, Type, Total, Received/Paid, Balance. | Listing only. |
| Profit & Loss | See §2.10. Has a "Vyapar" view and an "Accounting" view. | §2.10 |
| Bill Wise Profit | One row per sale invoice. Filters: date, party. Columns: Date, Inv No, Party, Total Sale Amount, Profit/Loss. "Show >" drills into item lines. Summary footer. | Per bill: Σ (line sale amount excl. tax − qty × item purchase price). Whether the cost is the item's purchase price or the actual batch cost is **unverified**. |
| Sale Aging | Columns: Party, Total Pending, and days-overdue buckets. | Buckets of unpaid balance by (today − invoice/due date). Bucket edges (e.g. 0-30/31-45/46-60/>60) are **unverified**. |
| Cash Flow | Cash in and cash out with a running balance. Filters: month or between dates, firm. Toggle: "Show zero amount transaction". | Running = opening cash + Σ in − Σ out (cash account only). |
| Trial Balance | Closing balances of all ledgers. Options: "Show working trial balance", "Show 0 balances account". | Σ Debit = Σ Credit across ledgers. |
| Balance Sheet | Position as of the "To" date. Layout: Horizontal (T) or Vertical. | §2.11 |

### 2.2 Party reports [FL]
- **Party Statement**: all transactions with one party in a period. Columns: Date, Txn type, Ref, Total, Received/Paid, Txn balance, Receivable/Payable running balance. Opening and closing balance appear in header and footer. Toggle between a "Vyapar" view (txn-centric) and an "Accounting" view (Debit/Credit/Running balance ledger). The view toggle is **unverified** for this report; it is confirmed only for P&L [TR].
- **Party-wise Profit & Loss**: per party, Σ sale − Σ cost of goods sold to that party (same basis as Bill Wise Profit). This is a paid-plan report.
- **All Parties**: each party's receivable/payable on a chosen date. Filters: party group, "show zero balance".
- **Party Report by Items**: quantity and amount of each item sold to or bought from a selected party.
- **Sale/Purchase by Party**: sale and purchase totals per party for the period.
- **Sale/Purchase by Party Group**: the same, aggregated by party group.

### 2.3 GST reports [FL], [GST]
- **GSTR-1** (outward). Sections follow the portal tables: B2B, B2CL, B2CS, CDNR/CDNUR (credit notes), Exports, Nil/Exempt, HSN summary, Docs issued. The section list is **unverified** from Vyapar docs but is mandated by the portal format.
- **GSTR-2** (inward, from purchases and GST expenses).
- **GSTR-3B**: monthly summary. 3.1 outward liability, 4 eligible ITC, 5 exempt inward, 6 payment. The table numbers come from the statutory form.
- **GST Detail Report**: detailed GSTR-1/2/3B lines for any month.
- **GSTR-9**: annual return compiled from the monthly/quarterly returns.
- **Composition**: GSTR-4 and GSTR-9A [FL].
- **Sale Summary by HSN**: per HSN, showing UQC, total qty, taxable value, IGST/CGST/SGST/Cess, total.
- Export: Excel and JSON for portal upload [GST].

### 2.4 Item / Stock reports [FL], [STK], [GD], [LS]
- **Stock Summary**: per item, showing Sale Price, Purchase Price, Stock Qty, Stock Value. Filters: date (as of), category, godown, "show items in stock only" (filter **unverified**). Valuation: Vyapar pages contradict each other. One says FIFO, another says selectable FIFO/LIFO/Weighted Average (https://vyaparapp.in/blog/inventory-valuation-methods/). **Unverified**. In-app, value commonly equals qty × purchase price.
- **Item Report by Party**: per item, quantity and amount sold to or bought from each party.
- **Item-wise Profit/Loss**: per item, Sale − Cost (with returns netted, **unverified**).
- **Low Stock Summary**: items with qty < Minimum Stock Qty. Shows Min qty, Stock qty, Stock value [LS].
- **Item Detail**: per item per day, showing Sale qty, Purchase qty, Adjustment qty, Closing qty.
- **Stock Detail**: per item, Opening qty, Qty in, Qty out, Closing qty for the period.
- **Sale/Purchase by Item Category**: quantity sold and bought per category.
- **Stock Summary by Item Category**: quantity and value per category.
- **Item Batch Report / Item Serial Report**: current qty by batch or serial number.
- **Item-wise Discount**: discount given per sold item.
- **Item Category-wise Profit & Loss**: not found in any source. **Unverified**; it may not exist.

### 2.5 Business status [FL]
- **Bank Statement**: per account, daily deposits and withdrawals with running balance.
- **Discount Report**: per party, discount given (sale) and received (purchase).

### 2.6 Taxes [FL]
- **Tax Report**: per party/txn, tax collected on sales and tax paid on purchases.
- **Tax Rate Report**: tax collected and paid grouped by rate (0/5/12/18/28 or custom). Columns: taxable value and tax.

### 2.7 Expense [EXP], [FL]
- Expense Transaction Report, Expense Category Report, Expense Item Report.

### 2.8 Sale/Purchase order [FL]
- Order Transaction Report (with open/closed status), Order Item Report.

### 2.9 Other income & Loan [FL], [OI]
- Other Income: Transaction, Category, and Item reports.
- **Loan Statement**: per loan account, showing opening, disbursal, EMI paid (principal / interest split), charges, closing.

### 2.10 Profit & Loss calculation
Sourced [PL], [PLB]:
- `Gross Profit = (Sales − Purchases) + (Closing Stock − Opening Stock) − Direct Expenses`. The blog's text reads "(Sale − Purchase) − (Closing − Opening)"; the sign is an evident typo, and standard COGS is used here.
- `Net Profit = Gross Profit + Other Income − Indirect Expenses`.
- Whether an expense is direct or indirect comes from the expense category type [EXP].
- Accounting view = T-format / vertical [PL].

In-app line items (**unverified**, check against the shop's install):
- `+ Sale (excl. tax) − Credit Note (sale return)`
- `− Purchase (excl. tax) + Debit Note (purchase return)`
- `− Direct expenses` (incl. Payment-Out discount, **unverified**)
- `− Opening Stock + Closing Stock` (stock at item purchase price)
- `= Gross Profit`
- `+ Other Income − Indirect expenses` (other expense, loan interest, loan processing fee, Payment-In discount)
- `= Net Profit`
- Taxes are excluded from P&L because GST is a liability/asset.

### 2.11 Balance Sheet [BS]
- Assets: Current Assets = Stock-in-Hand (closing stock) + Sundry Debtors (Σ party receivables) + Cash + Bank accounts + other.
- Equity & Liabilities: Capital (opening balances/owner) + Reserves & Surplus (= cumulative Net Profit from P&L) + Loans (loan accounts) + Current Liabilities (Sundry Creditors = Σ payables; GST payable, **unverified**).
- Opening balances are taken at the From date. The report is struck as of the To date. It must balance; if it doesn't, the usual cause is missing bank/cash opening balances.

---

## 3. Settings [FL] unless noted

### General
- App language, business currency, **decimal places** (amount), date format, unsaved-changes warning, theme, screen zoom (zoom is **unverified**).
- **Passcode** / fingerprint for the app.
- **Multi-firm**: several firms share parties and items. Each txn picks a firm, and reports filter by firm.
- **Auto backup** to Google Drive. **Audit trail**: **unverified** (the term appears in no Vyapar source; possibly added for MCA audit-trail rules).
- **Godown management & Stock transfer** checkbox (needs stock maintenance) [GD].
- **More Transactions** toggles: Estimate/Quotation, Other Income, Sale/Purchase Order, Delivery Challan, goods return on challan, print amount on challan.
- **Stop sale on negative stock** and **block new items/parties from the txn form**: **unverified**. No public source found. Assume Vyapar allows negative stock by default.

### Transaction
- Header: Invoice/Bill No. (auto-increment, editable), **Cash Sale by default**, billing name of party (**unverified**), PO details (PO no/date), add time on txn, print time on invoice.
- Items table: tax inclusive/exclusive rate, display purchase price, free item qty, count, barcode scanning.
- Taxes/discount/total: **transaction-wise tax**, **transaction-wise discount**, **round off** (nearest/up/down and to 1/10 etc. are **unverified**).
- More: share invoice as image, passcode for edit/delete, discount during payment, link payment to invoices (bill-wise allocation), due date & payment terms, invoice preview, additional fields, transportation details, **additional charges** (shipping/packing, GST via SAC [GST]), show profit on sale [DSC].
- GST: reverse charge, state of supply, e-way bill no.
- **Transaction prefixes** per document type (Sale, Credit Note, Sale Order, Estimate, Challan, Payment-In…), per firm.

### Invoice Print [PRN]
- Printer type **Regular** (A4/A5, multiple themes, e.g. "GST Theme 1", plus colours) or **Thermal** (2"/58 mm, 3"/80 mm, 4"/88 mm; Themes 1-4).
- Regular toggles:
  - Repeat header on all pages; company name, logo, GSTIN, address, phone, email.
  - Orientation; company-name and invoice text size; extra top space for pre-printed header.
  - Original/Duplicate copy label.
  - Rename txn titles (e.g. "Tax Invoice").
  - Item columns (HSN, MRP, tax, description, batch fields) with draggable widths; minimum rows.
  - Totals: total qty, received, balance, tax details, "You saved".
  - Amount in words (Indian/English) and Indian digit grouping.
  - Footer: description, T&C, payment mode, acknowledgement, authorised signatory.
- Bank details and UPI QR checkboxes live on the bank account [BANK].
- Thermal adds: text printing, bold, extra lines before cut, auto-cut, open cash drawer.

### Taxes & GST
- Enable GST; HSN/SAC; additional cess; reverse charge; state of supply; e-way bill no.; composite scheme.
- **Tax list**: custom rates and tax groups (e.g. GST@3 = CGST1.5 + SGST1.5) [FL], [GST].

### Party
- GSTIN, **party grouping**, **additional fields** (custom, printable), **shipping address** plus "print shipping address", invite parties via link, **payment reminders** (enable, template with [Party Name]/[Amount]/[Business Name], bulk send) [REM].
- Default party discount % [DSC].
- **Credit limit**: **unverified**.

### Item
- Enable item; item type (product/service/both); **barcode scan**; **stock maintenance**; **show low-stock dialog** [LS].
- **Item units**: base and secondary with conversion rate. **Default unit**.
- **Item category**; **party-wise item rate** (remembers the last rate per party).
- Quantity decimals; **item-wise tax**; **item-wise discount**; **update sale price from txn**.
- **Additional item fields**: MRP, Serial No (IMEI), Batch No, Exp date (mm/yy or dd/mm/yy), Mfg date, Model No, Size, plus custom fields [BAT], [FL].
- Description; HSN/cess.

### Transaction message [MSG]
- Send to party (WhatsApp first, SMS fallback; "Send via Vyapar" or personal WhatsApp).
- Include party current balance; web invoice link.
- Auto-send per txn type (Sale, Purchase, Payment-In, Sale Return…).
- Editable template; SMS copy to self [FL].

### Sync / users [SYNC]
- The admin device invites users by phone/email. Roles such as Salesman and Accountant restrict views such as profit reports; the per-role permission matrix is **unverified**. Sync is a paid feature.

---

## 4. Item form & Sale/Purchase form

### Item form [STK], [GST], [BAT]
- Name, Item Code / **Assign Code** (auto-generates a barcode-able code, **unverified**), HSN, Unit (select base/secondary + conversion), Category, image.
- Tabs **Pricing / Stock / (Online Store)** (**unverified** tab names):
  - Pricing: Sale Price (with/without tax), discount on sale price (%/amt), **Wholesale Price + Minimum Wholesale Qty**, Purchase Price (with/without tax), Tax rate.
  - Stock: Opening Qty, At Price, As-of Date, Min Stock Qty, Location; batch or serial tracking pop-up (MRP, Batch, Mfg, Exp, Size, Opening qty).
- Wholesale rule (**unverified**): if line qty ≥ min wholesale qty, the rate switches to the wholesale price.
- Adjust Stock: Add or Reduce qty, with date, at price, and details/reason [STK].

### Sale / Purchase form
- Header: Customer (search/add), Billing name, Phone, Billing/Shipping address, Invoice No (prefix + seq), Date, **State of Supply**, Godown [GD], PO no/date, E-way bill.
- Line columns: #, Item, (Description/Batch/Serial/MRP/Size columns when enabled), Qty, Unit, Price/Unit (with/without tax), Discount (% ↔ amt) [DSC], Tax (% ↔ amt), Amount. Free qty optional.
- Calculation order per line [DSC], [GST]:
  - `gross = qty × rate`
  - `taxable = gross − itemDiscount`
  - `tax = taxable × rate%`
  - `lineAmt = taxable + tax`
- Bill-level calculation:
  - `subtotal = Σ lineAmt`
  - Apply transaction-wise discount (%/amt) and transaction-wise tax if enabled, then additional charges (taxable).
  - `roundOff = round(total) − total` (shown, editable)
  - `Total`, then `Received/Paid`, then `Balance = Total − Received`.
- Supply rule: GST split = **CGST+SGST if state of supply = firm state, else IGST** [GST].
- Payment: type Cash / Cheque / Bank account(s) / UPI. **Split payment** across types via "+ Add payment type" (**unverified**). Cash Sale mode auto-fills Received = Total.
- Description box; add image/document; terms; due date/payment terms.
- **Multiple invoice tabs** open simultaneously (**unverified**).
- Save, Save & New, Share (WhatsApp/PDF/image), Print, Preview [FL].
- Keyboard shortcuts: Vyapar billing desktop shortcuts are **unverified**. The only documented ones (Ctrl+S save) are for Vyapar TaxOne: https://taxone.vyapar.com/help/articles/shortcut-keys.

---

## 5. Cash & Bank, payments, loans, expenses [BANK], [FL], [EXP], [OI]

- **Bank account**:
  - Fields: display name, opening balance, as-of date, account no, IFSC, bank name, holder.
  - Checkboxes: "Print bank details on invoices", "Print offline UPI QR on invoices".
  - Optional Razorpay online payments.
- **Transfers**: bank→cash, cash→bank, bank→bank; **adjust balance** (increase/reduce). Present in-app; screens are **unverified** in docs.
- **Cash in Hand**: running cash ledger, plus adjust cash.
- **Cheques**: cheques received or paid on txns appear as Open. Actions are Deposit/Withdraw (choose bank, date) and Reopen. Until cleared, the money is not in the bank balance. Actions and clearing behaviour are **unverified**.
- **Payment-In / Payment-Out**:
  - Party, amount, payment type, ref no, date, description, discount (if "discount during payment" is on).
  - With "link payment to invoices", amounts are allocated to open bills (oldest first or manual).
  - Unallocated amount stays as party advance.
- **Loan accounts**: account name, lender, opening balance/loan amount, interest rate, duration, processing fee, received-in (cash/bank). Txns: Make payment (principal + interest), Increase loan, Charges. Feeds the Loan Statement; interest and fees go to P&L indirect expenses. Fields are **unverified**.
- **Expenses**:
  - GST toggle: ON requires a party and state of supply, and claims ITC.
  - Category typed **Direct/Indirect**, plus expense items (name, HSN/SAC, price, tax), payment Cash/Bank, image/document attachment.
- **Other income**: enabled in General settings. Category, item, qty, price, date, payment mode, description. Reports by category and item.
- **Journal entries**: Settings → Accounting. Date, Dr account, Cr account, amount, narration; feeds ledgers and P&L [JE].

---

## 6. Jewellery-specific features & limitations [JW]

Vyapar's jewellery landing page *claims*:
- Weight from USB/Bluetooth scale (Retail Pro plan).
- Purity/karat per item, with price from weight × purity × daily rate.
- Making charges fixed or %, per category; stones as separate lines.
- Wastage; split GST (3% metal, 5% making).
- HUID on invoice; gross/net/stone weight.
- Old-gold exchange adjusted against the bill.
- Karigar job orders; barcode tags; loyalty points.

Limitations and caveats:
- These are **marketing claims, unverified in any help guide**. No guide documents weight fields, rate masters, making-charge settings, or old-gold flows.
- The page itself does not explain rate entry/updating, wastage on sale bills, old-gold testing/deduction rules, silver/platinum purity, or BIS HUID verification.
- Its plan names conflict (it mentions a "Jewellery Pro" plan absent from pricing).
- In core Vyapar, practical jewellery billing is usually done with generic items + Additional Item Fields (Size/Model/Batch) + additional charges for making. Units such as GMS use decimal qty.
- Consequence for our ERP: weight, purity, rate, making, wastage, and old-gold logic are ours to define (see `docs/BILLING_RULES.md`). Vyapar parity should target the *report and settings behaviour* above, not jewellery maths.
