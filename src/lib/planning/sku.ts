// SKU identity normalization.
//
// Purchase orders reference a full `sku_code` of 6 segments
// (e.g. VM-01-BAT0-0007-01-01). The forecast and inventory layers key on the
// `sku_base` = the first 4 segments (VM-01-BAT0-0007). Several sku_codes can map to
// one sku_base (colour / revision variants), so all planning math aggregates at
// sku_base. Rule lifted verbatim from the forecast-lab: '-'.join(split('-')[:4]).

export function toSkuBase(skuCode: string): string {
  const trimmed = skuCode.trim();
  const parts = trimmed.split('-');
  return parts.length <= 4 ? trimmed : parts.slice(0, 4).join('-');
}
