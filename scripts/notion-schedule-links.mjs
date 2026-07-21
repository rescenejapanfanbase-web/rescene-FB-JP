const plainText = (items = []) =>
  items.map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim();

const propertyTextItems = (property = {}) => property.rich_text ?? property.title ?? [];
const propertyText = (property = {}) => {
  const direct = plainText(propertyTextItems(property));
  if (direct) return direct;
  return String(property.formula?.string ?? property.url ?? "").trim();
};
const propertyUrls = (property = {}) => {
  const values = [property.url, property.formula?.string];
  for (const item of propertyTextItems(property)) {
    values.push(item?.href, item?.text?.link?.url);
    const plain = String(item?.plain_text ?? item?.text?.content ?? "").trim();
    if (plain) values.push(plain);
  }
  return values.map((value) => String(value ?? "").trim()).filter(Boolean);
};

export const normalizeScheduleLink = (value = "") => {
  let link = String(value).trim().replace(/^<|>$/g, "");
  if (!link) return "";
  if (/^www\./i.test(link)) link = `https://${link}`;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i.test(link)) link = `https://${link}`;
  if (/^(https?:\/\/[^\s]+|[A-Za-z0-9_.\/-]+\.html(?:[?#].*)?|#[A-Za-z0-9_-]+)$/i.test(link)) return link;
  return "";
};

const unique = (values = []) => [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];

export function scheduleLinkFromProperties(properties = {}) {
  const urlNames = ["リンクURL", "リンク", "リンク (1)", "URL", "関連リンク", "詳細URL", "公式URL", "申込URL", "チケットURL", "配信URL"];
  const labelNames = ["リンク名", "リンク名 (1)", "ボタン文言", "リンク文言", "リンクテキスト", "URL名"];
  const urlValues = [];
  const labelValues = [];

  for (const name of urlNames) {
    const property = properties[name];
    if (!property) continue;
    urlValues.push(...propertyUrls(property), propertyText(property));
  }
  for (const name of labelNames) {
    const property = properties[name];
    if (!property) continue;
    labelValues.push(propertyText(property), ...propertyUrls(property));
  }

  for (const [name, property] of Object.entries(properties)) {
    if (!/(リンク|URL)/i.test(name) || urlNames.includes(name) || labelNames.includes(name)) continue;
    urlValues.push(...propertyUrls(property), propertyText(property));
  }

  // Notionのリッチテキスト内で「詳細はこちら」の文字にURLを設定した場合も拾う。
  for (const name of ["テキスト", "メモ", "説明", "詳細"]) {
    const property = properties[name];
    if (!property) continue;
    const linkedItems = propertyTextItems(property).filter((item) => item?.href || item?.text?.link?.url);
    for (const item of linkedItems) {
      urlValues.push(item?.href, item?.text?.link?.url);
      labelValues.push(item?.plain_text ?? item?.text?.content ?? "");
    }
  }

  const combined = unique([...urlValues, ...labelValues]);
  const link = combined.map(normalizeScheduleLink).find(Boolean) || "";
  const linkLabel = unique([...labelValues, ...urlValues])
    .find((value) => !normalizeScheduleLink(value) && value.length <= 80) || "詳細を見る";
  return { link, linkLabel };
}
