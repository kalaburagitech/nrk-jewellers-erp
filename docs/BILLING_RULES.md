# Billing calculation rules — confirm with the client's CA before go-live

These are the calculation rules implemented in `src/lib/jewelry-calc.ts` and
`convex/sales.ts`. They are reasonable, commonly-used conventions, but
jewellery billing/GST conventions vary by shop and by CA — **confirm each of
these with NRK Jewellers' accountant before relying on them for real GST
filing.**

## Per-item sale calculation

```
netWeight      = grossWeight - stoneWeight - otherDeduction
metalValue     = netWeight × ratePerGram
wastageValue   = metalValue × wastage%
taxableValue   = metalValue + wastageValue + makingCharge + stoneCharge
tax            = taxableValue × (CGST% + SGST% + IGST%)     [0 if non-GST]
lineTotal      = taxableValue + tax
```

**Assumption**: wastage is charged as a percentage of metal value (money),
not as extra grams added to the weight. Some shops instead compute wastage
as extra *weight* (e.g. net weight × 1.08) and charge metal value on that
inflated weight. Both approaches are common; they are not numerically
identical when making charges are also weight-based. Confirm which
convention NRK Jewellers actually uses.

**Assumption**: GST is charged on the full taxable value (metal + wastage +
making + stone charge) as a single line, matching how jewellery HSN codes
are typically taxed. Confirm there's no requirement to tax making charges
under a different HSN/rate than the metal value.

## Bill-level discount

Discount (percentage or fixed amount) is applied to the **pre-tax
subtotal** across all items, then GST is calculated per item on the
*original* taxable value (the discount does not reduce the taxable value
used for tax):

```
total = (itemsSubtotal - discount) + itemsTax + roundOff
```

**Assumption**: this is a "cash discount" model — it reduces what the
customer pays but does not retroactively reduce the GST base. If the
client's CA requires GST to be charged on the post-discount value instead
(common for some discount types under GST law), the discount needs to be
distributed across items before each item's tax is computed. This is a
Phase 1 simplification; flag it for review before relying on this for
GSTR-1/3B filings.

## Round-off

The final total is rounded to the nearest whole rupee; the signed
adjustment (±49 paise max) is stored as `roundOffPaise` and shown as its own
line on the bill — never silently absorbed into another figure.

## Old gold exchange (implemented)

```
meltingLoss     = grossWeight × meltingDeduction%
netWeight       = grossWeight - meltingLoss
exchangeValue   = netWeight × agreedRate
```

Recorded as its own `oldGoldExchanges` row (gross weight, purity, melting
deduction %, rate, computed value — never hidden inside a generic payment)
linked to the sale, and also inserted into `payments` with mode
`"old_gold_exchange"` so it nets correctly against the bill total alongside
cash/UPI/card payments. The agreed rate is entered by the operator per
exchange (shops commonly buy old gold below the day's selling rate) rather
than defaulting to the current sell rate — confirm this is the desired UX
with the client.

## Not yet implemented (flagged, not silently dropped)

- **Advance booking adjustments** (SRS §8, §13 roadmap Stage 4): deferred to
  a follow-up milestone.
- **Item-level discount**: only bill-level discount exists; the schema has
  no per-item discount field yet.
