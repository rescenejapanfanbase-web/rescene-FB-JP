(async () => {
  let schedulePayload = window.RESCENE_SCHEDULE_PAYLOAD && typeof window.RESCENE_SCHEDULE_PAYLOAD === "object"
    ? window.RESCENE_SCHEDULE_PAYLOAD
    : { generatedAt: window.RESCENE_SCHEDULE_GENERATED_AT || "", events: Array.isArray(window.RESCENE_SCHEDULE) ? window.RESCENE_SCHEDULE : [] };
  try {
    const response = await fetch(`data/schedule.json?v=${Date.now()}`, { cache: "no-store" });
    if (response.ok) {
      const payload = await response.json();
      if (Array.isArray(payload?.events)) schedulePayload = payload;
    }
  } catch (error) {
    console.warn("最新スケジュールJSONの取得に失敗したため、JSデータを使用します。", error);
  }

  let baseEvents = Array.isArray(schedulePayload.events) ? schedulePayload.events : [];
  const recurringBirthdays = [
    { name: "WONI", month: 5, day: 25, description: "ウォニの誕生日です。", link: "members.html#woni-profile" },
    { name: "MAY", month: 8, day: 19, description: "メイの誕生日です。", link: "members.html#may-profile" },
    { name: "LIV", month: 10, day: 11, description: "リブの誕生日です。", link: "members.html#liv-profile" },
    { name: "ZENA", month: 11, day: 27, description: "ゼナの誕生日です。", link: "members.html#zena-profile" },
    { name: "MINAMI", month: 11, day: 29, description: "ミナミの誕生日です。", link: "members.html#minami-profile" },
  ];

  const grid = document.getElementById("calendarGrid");
  const title = document.getElementById("calendarTitle");
  const list = document.getElementById("scheduleEvents");
  const listTitle = document.getElementById("scheduleListTitle");
  const categoryFilters = document.getElementById("scheduleCategoryFilters");
  const lastUpdated = document.getElementById("scheduleLastUpdated");
  const monthViewButton = document.getElementById("scheduleMonthView");
  const todayViewButton = document.getElementById("scheduleTodayView");
  const prev = document.getElementById("prevMonth");
  const next = document.getElementById("nextMonth");
  if (!grid || !title || !list || !prev || !next) return;

  const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const safeLink = (value = "") => {
    let url = String(value).trim();
    const oldArticle = url.match(/^article\.html\?id=([^&#]+)/i);
    if (oldArticle) url = `articles/${encodeURIComponent(decodeURIComponent(oldArticle[1]))}.html`;
    if (!url) return "";
    if (/^(https?:\/\/[^\s]+|[A-Za-z0-9_.\/-]+\.html(?:[?#].*)?|#[A-Za-z0-9_-]+)$/i.test(url)) return url;
    return "";
  };
  const safeAsset = (value = "") => {
    const url = String(value).trim().replace(/^\/+/, "");
    if (!url) return "";
    if (/^https?:\/\/[^\s]+$/i.test(url)) return url;
    if (/^(?:assets|news|schedule|images|img)\/[A-Za-z0-9_.%/()@+\-]+$/i.test(url)) return url;
    return "";
  };
  const cleanDescription = (value = "") => String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^Plus Chat公式スケジュールから自動取得$/i.test(line) && !/^原文\s*[:：]/i.test(line))
    .join("\n");
  const calendarFeedUrl = new URL("data/rescene-schedule.ics", document.baseURI).href;
  const calendarPageUrl = new URL("schedule.html", document.baseURI).href;
  const pad = (value) => String(value).padStart(2, "0");
  const iso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const addDaysText = (value, count) => {
    const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + count);
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  };
  const googleDate = (date) => `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  const dateOnlyCalendar = (value) => String(value).slice(0, 10).replaceAll("-", "");
  const toDate = (value = "") => {
    const date = new Date(String(value).includes("T") ? value : `${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const eventDates = (event) => {
    const start = toDate(event.date || event.start || "");
    if (!start) return [];
    const end = toDate(event.end || event.date || event.start || "") || start;
    const dates = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    while (cursor <= last && dates.length < 370) {
      dates.push(iso(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  };
  const formatTime = (event) => {
    if (!String(event.start || "").includes("T")) return "";
    const start = toDate(event.start);
    const end = event.end ? toDate(event.end) : null;
    if (!start) return "";
    const fmt = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
    return end ? `${fmt.format(start)}〜${fmt.format(end)}` : fmt.format(start);
  };
  const tokyoDateKey = () => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const tokyoToday = tokyoDateKey();

  const formatUpdatedAt = (value) => {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "確認中";
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).format(date).replaceAll("/", ".");
  };
  if (lastUpdated) lastUpdated.textContent = `最終更新：${formatUpdatedAt(schedulePayload.generatedAt)}`;

  const calendarRange = (event) => {
    const startValue = String(event.start || event.date || "");
    if (startValue.includes("T")) {
      const start = new Date(startValue);
      let end = event.end ? new Date(event.end) : new Date(start.getTime() + 60 * 60 * 1000);
      if (Number.isNaN(end.getTime()) || end <= start) end = new Date(start.getTime() + 60 * 60 * 1000);
      return `${googleDate(start)}/${googleDate(end)}`;
    }
    const startDate = startValue.slice(0, 10);
    const inclusiveEnd = String(event.end || startDate).slice(0, 10);
    return `${dateOnlyCalendar(startDate)}/${dateOnlyCalendar(addDaysText(inclusiveEnd, 1))}`;
  };
  const absoluteEventLink = (event) => {
    const link = safeLink(event.link);
    if (!link) return "";
    try { return new URL(link, document.baseURI).href; } catch { return ""; }
  };
  const eventPageLink = (event) => `${calendarPageUrl}?date=${encodeURIComponent(String(event.start || event.date || "").slice(0, 10))}&event=${encodeURIComponent(event.id || "")}`;
  const eventDescription = (event) => [cleanDescription(event.description), absoluteEventLink(event) ? `関連リンク: ${absoluteEventLink(event)}` : "", `RESCENE JAPAN FANBASE: ${eventPageLink(event)}`].filter(Boolean).join("\n\n");
  const googleCalendarLink = (event) => {
    const params = new URLSearchParams({ action: "TEMPLATE", text: event.title || "RESCENE 予定", dates: calendarRange(event), details: eventDescription(event), ctz: "Asia/Tokyo" });
    const link = absoluteEventLink(event);
    if (link) params.set("location", link);
    return `https://calendar.google.com/calendar/r/eventedit?${params.toString()}`;
  };
  const escapeIcs = (value = "") => String(value).replaceAll("\\", "\\\\").replaceAll("\r\n", "\\n").replaceAll("\n", "\\n").replaceAll("\r", "\\n").replaceAll(";", "\\;").replaceAll(",", "\\,");
  const eventIcs = (event) => {
    const startValue = String(event.start || event.date || "");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//RESCENE JAPAN FANBASE//Schedule//JA", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT", `UID:${String(event.id || Date.now()).replace(/[^a-zA-Z0-9._-]/g, "-")}@rescene-fb.jp`, `DTSTAMP:${googleDate(new Date())}`, `SUMMARY:${escapeIcs(event.title || "RESCENE 予定")}`];
    if (startValue.includes("T")) {
      const start = new Date(startValue);
      let end = event.end ? new Date(event.end) : new Date(start.getTime() + 60 * 60 * 1000);
      if (Number.isNaN(end.getTime()) || end <= start) end = new Date(start.getTime() + 60 * 60 * 1000);
      lines.push(`DTSTART:${googleDate(start)}`, `DTEND:${googleDate(end)}`);
    } else {
      const startDate = startValue.slice(0, 10);
      const inclusiveEnd = String(event.end || startDate).slice(0, 10);
      lines.push(`DTSTART;VALUE=DATE:${dateOnlyCalendar(startDate)}`, `DTEND;VALUE=DATE:${dateOnlyCalendar(addDaysText(inclusiveEnd, 1))}`);
    }
    lines.push(`DESCRIPTION:${escapeIcs(eventDescription(event))}`);
    const link = absoluteEventLink(event);
    if (link) lines.push(`URL:${link}`);
    if (event.category) lines.push(`CATEGORIES:${escapeIcs(event.category)}`);
    lines.push("STATUS:CONFIRMED", "TRANSP:TRANSPARENT", "END:VEVENT", "END:VCALENDAR");
    return `${lines.join("\r\n")}\r\n`;
  };
  const downloadEventIcs = (event) => {
    const blob = new Blob([eventIcs(event)], { type: "text/calendar;charset=utf-8" });
    const objectLink = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectLink;
    anchor.download = `${String(event.title || "RESCENE-event").replace(/[\\/:*?"<>|]/g, "-")}.ics`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectLink), 1500);
  };

  const categoryName = (event) => String(event.category || "イベント").trim() || "イベント";
  const categoryPalettes = [
    { bg: "rgba(255,78,157,.27)", color: "#ff5fa5" },
    { bg: "rgba(150,105,255,.28)", color: "#b68cff" },
    { bg: "rgba(52,151,255,.27)", color: "#65b5ff" },
    { bg: "rgba(39,190,137,.26)", color: "#54d7a9" },
    { bg: "rgba(255,139,43,.28)", color: "#ff9f4d" },
    { bg: "rgba(232,183,31,.28)", color: "#f3c84d" },
    { bg: "rgba(28,181,185,.27)", color: "#49d0d2" },
    { bg: "rgba(147,151,170,.24)", color: "#b9bdcf" },
  ];
  const knownCategoryPalette = {
    Birthday: categoryPalettes[1], "誕生日": categoryPalettes[1], "リリース": categoryPalettes[0],
    "音楽番組": categoryPalettes[2], "仕事": categoryPalettes[2], "記録": categoryPalettes[3],
    "イベント": categoryPalettes[4], "投票": categoryPalettes[5], "出演": categoryPalettes[6],
    "お知らせ": categoryPalettes[7], "その他": categoryPalettes[7],
    "プライベート": { bg: "rgba(255,83,145,.26)", color: "#ff74ae" },
  };
  const categoryPalette = (category) => {
    const name = String(category || "イベント");
    if (knownCategoryPalette[name]) return knownCategoryPalette[name];
    let hash = 0;
    for (const char of name) hash = ((hash * 31) + char.codePointAt(0)) >>> 0;
    return categoryPalettes[hash % categoryPalettes.length];
  };
  const categoryStyle = (event) => {
    const palette = categoryPalette(categoryName(event));
    return `--category-bg:${palette.bg};--category-color:${palette.color}`;
  };
  let activeCategory = "all";
  const matchesActiveCategory = (event) => activeCategory === "all" || categoryName(event) === activeCategory;

  const recurringEventsForYear = (year) => {
    const events = recurringBirthdays.map((member) => ({
      id: `auto-birthday-${member.name.toLowerCase()}-${year}`,
      title: `${member.name} 誕生日`, date: `${year}-${pad(member.month)}-${pad(member.day)}`,
      start: `${year}-${pad(member.month)}-${pad(member.day)}`, end: "", category: "Birthday", type: "birthday",
      description: member.description, link: member.link, linkLabel: `${member.name}プロフィールを見る`, image: "", recurringMember: member.name,
    }));
    if (year >= 2024) {
      const anniversary = year - 2024;
      events.push({
        id: `auto-debut-anniversary-${year}`,
        title: anniversary > 0 ? `RESCENE デビュー${anniversary}周年` : "RESCENE デビュー記念日",
        date: `${year}-03-26`, start: `${year}-03-26`, end: "", category: "記録", type: "record",
        description: anniversary > 0 ? `2024年3月26日にデビューしたRESCENEのデビュー${anniversary}周年記念日です。` : "2024年3月26日にRESCENEがデビューしました。",
        link: "about.html", linkLabel: "RESCENEについて見る", image: "", recurringAnniversary: true,
      });
    }
    return events;
  };
  const isRecurringDuplicate = (candidate, sourceEvents) => sourceEvents.some((event) => {
    if (!eventDates(event).includes(candidate.date)) return false;
    const titleText = String(event.title || "").toUpperCase().replace(/\s+/g, "");
    if (candidate.recurringMember) return titleText.includes(candidate.recurringMember) && /BIRTHDAY|誕生日/.test(titleText);
    return candidate.recurringAnniversary && /デビュー|ANNIVERSARY/.test(titleText);
  });
  const eventsForYears = (...years) => {
    const recurring = [...new Set(years)].flatMap(recurringEventsForYear).filter((candidate) => !isRecurringDuplicate(candidate, baseEvents));
    return [...baseEvents, ...recurring].sort((a, b) => String(a.start || a.date || "").localeCompare(String(b.start || b.date || "")) || String(a.title || "").localeCompare(String(b.title || ""), "ja"));
  };

  const scheduleParams = new URLSearchParams(location.search);
  const requestedDateText = String(scheduleParams.get("date") || "").slice(0, 10);
  const requestedDate = toDate(requestedDateText);
  const requestedEventId = scheduleParams.get("event") || "";
  const initial = requestedDate || toDate(tokyoToday) || new Date();
  let view = new Date(initial.getFullYear(), initial.getMonth(), 1);
  let selectedDate = requestedDate ? requestedDateText : "";
  const eventAnchor = (value) => `event-${String(value || "").replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  function renderCategoryControls(events) {
    if (!categoryFilters) return;
    const counts = new Map();
    events.forEach((event) => counts.set(categoryName(event), (counts.get(categoryName(event)) || 0) + 1));
    const names = [...counts.keys()].sort((a, b) => a.localeCompare(b, "ja"));
    if (activeCategory !== "all" && !counts.has(activeCategory)) activeCategory = "all";
    const allButton = `<button class="schedule-category-filter${activeCategory === "all" ? " active" : ""}" type="button" data-schedule-category="all" style="--category-bg:rgba(255,255,255,.12);--category-color:var(--text)">すべて <span>${events.length}</span></button>`;
    categoryFilters.innerHTML = allButton + names.map((name) => {
      const palette = categoryPalette(name);
      return `<button class="schedule-category-filter${activeCategory === name ? " active" : ""}" type="button" data-schedule-category="${escapeHtml(name)}" style="--category-bg:${palette.bg};--category-color:${palette.color}">${escapeHtml(name)} <span>${counts.get(name)}</span></button>`;
    }).join("");
  }

  function listHeading(year, month) {
    if (selectedDate) {
      if (selectedDate === tokyoToday) return "今日のスケジュール";
      const date = toDate(selectedDate);
      return date ? `${date.getMonth() + 1}月${date.getDate()}日のスケジュール` : "スケジュール";
    }
    const today = toDate(tokyoToday);
    if (today && today.getFullYear() === year && today.getMonth() === month) return "今月のスケジュール";
    return `${year}年${month + 1}月のスケジュール`;
  }

  function renderEventList(events, year, month) {
    const filtered = selectedDate
      ? events.filter((event) => eventDates(event).includes(selectedDate))
      : events.filter((event) => {
        const dates = eventDates(event);
        return dates.some((value) => value.startsWith(`${year}-${pad(month + 1)}-`));
      });
    if (listTitle) listTitle.textContent = listHeading(year, month);
    monthViewButton?.classList.toggle("active", !selectedDate);
    todayViewButton?.classList.toggle("active", selectedDate === tokyoToday);

    if (!filtered.length) {
      list.innerHTML = `<div class="card schedule-empty"><p class="muted">${selectedDate ? "この日のスケジュールはありません。" : "この月に公開されている予定はありません。"}</p></div>`;
      document.dispatchEvent(new CustomEvent("rescene:content-rendered"));
      return;
    }

    list.innerHTML = filtered.map((event) => {
      const date = toDate(event.date || event.start || "");
      if (!date) return "";
      const time = formatTime(event);
      const link = safeLink(event.link);
      const image = safeAsset(event.image);
      const external = /^https?:\/\//i.test(link);
      const action = link ? `<a class="btn btn-secondary schedule-related-link" href="${escapeHtml(link)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(event.linkLabel || "詳細を見る")}${external ? " ↗" : ""}</a>` : "";
      const linkHint = link ? '<span class="schedule-link-available">関連リンクあり</span>' : "";
      const eventUrl = eventPageLink(event);
      const shareText = `${String(event.start || event.date || "").slice(0, 10)} ${event.title || "RESCENE予定"}`;
      const calendarActions = `<div class="schedule-actions"><a class="btn calendar-google" href="${escapeHtml(googleCalendarLink(event))}" data-calendar-add="google" data-event-id="${escapeHtml(event.id || "")}" target="_blank" rel="noopener noreferrer">Googleカレンダー</a><button class="btn calendar-apple event-ics-button" type="button" data-event-id="${escapeHtml(event.id || "")}">Apple・ICS</button>${action}</div><div class="share-actions"><span class="share-actions-label">この予定を共有</span><button class="share-button" type="button" data-share-action="native" data-share-title="${escapeHtml(event.title)}" data-share-text="${escapeHtml(shareText)}" data-share-url="${escapeHtml(eventUrl)}">共有</button><button class="share-button" type="button" data-share-action="x" data-share-title="${escapeHtml(event.title)}" data-share-text="${escapeHtml(shareText)}" data-share-url="${escapeHtml(eventUrl)}">X</button><button class="share-button" type="button" data-share-action="line" data-share-title="${escapeHtml(event.title)}" data-share-text="${escapeHtml(shareText)}" data-share-url="${escapeHtml(eventUrl)}">LINE</button><button class="share-button" type="button" data-share-action="copy" data-share-title="${escapeHtml(event.title)}" data-share-url="${escapeHtml(eventUrl)}">URLコピー</button></div>`;
      const imageBlock = image ? `<figure class="schedule-detail-image"><img src="${escapeHtml(image)}" alt="${escapeHtml(event.title)}" loading="lazy"></figure>` : "";
      const descriptionText = cleanDescription(event.description);
      const description = descriptionText ? escapeHtml(descriptionText).replace(/\n/g, "<br>") : "";
      const descriptionSummary = description ? `<p>${description}</p>` : "";
      const descriptionDetail = description ? `<p>${description}</p>` : "";
      const isOpen = requestedEventId && String(event.id || "") === requestedEventId;
      const category = categoryName(event);
      return `<details class="schedule-row card" id="${eventAnchor(event.id)}" ${isOpen ? "open" : ""}><summary><div class="schedule-date"><strong>${pad(date.getMonth() + 1)}.${pad(date.getDate())}</strong><span>${date.toLocaleDateString("ja-JP", { weekday: "short" })}</span></div><div><div class="schedule-category-field">カテゴリー <span class="schedule-category-badge" style="${categoryStyle(event)}">${escapeHtml(category)}</span></div><h2>${escapeHtml(event.title)}</h2>${descriptionSummary}<div class="schedule-row-meta">${time ? `<span class="schedule-time">${escapeHtml(time)}</span>` : ""}${linkHint}</div></div></summary><div class="schedule-detail">${imageBlock}${descriptionDetail}${calendarActions}</div></details>`;
    }).join("");
    window.RESCENE_SHARE?.bind(list);
    document.dispatchEvent(new CustomEvent("rescene:content-rendered"));
    if (requestedEventId) requestAnimationFrame(() => document.getElementById(eventAnchor(requestedEventId))?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  function render() {
    const year = view.getFullYear();
    const month = view.getMonth();
    const events = eventsForYears(year - 1, year, year + 1);
    renderCategoryControls(events);
    const visibleEvents = events.filter(matchesActiveCategory);
    title.textContent = `${year}年 ${month + 1}月`;

    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    grid.innerHTML = "";
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = iso(date);
      const dayEvents = visibleEvents.filter((event) => eventDates(event).includes(key));
      const cell = document.createElement("button");
      const isToday = key === tokyoToday;
      const isSelected = key === selectedDate;
      cell.type = "button";
      cell.dataset.scheduleDate = key;
      cell.className = `calendar-day${date.getMonth() !== month ? " is-outside" : ""}${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}`;
      cell.setAttribute("aria-label", `${date.toLocaleDateString("ja-JP")}、予定${dayEvents.length}件`);
      cell.setAttribute("aria-pressed", String(isSelected));
      if (isToday) cell.setAttribute("aria-current", "date");
      cell.innerHTML = `<time datetime="${key}">${date.getDate()}</time><span class="calendar-events" aria-hidden="true">${dayEvents.map((event) => `<span class="calendar-event" style="${categoryStyle(event)}" title="${escapeHtml(categoryName(event))}｜${escapeHtml(event.title)}">${escapeHtml(event.title)}</span>`).join("")}</span>`;
      grid.appendChild(cell);
    }
    renderEventList(visibleEvents, year, month);
  }

  categoryFilters?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-schedule-category]");
    if (!button) return;
    activeCategory = button.dataset.scheduleCategory || "all";
    render();
  });
  grid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-schedule-date]");
    if (!button) return;
    selectedDate = button.dataset.scheduleDate || "";
    const date = toDate(selectedDate);
    if (date && (date.getFullYear() !== view.getFullYear() || date.getMonth() !== view.getMonth())) view = new Date(date.getFullYear(), date.getMonth(), 1);
    const params = new URLSearchParams(location.search);
    params.set("date", selectedDate);
    params.delete("event");
    history.replaceState(null, "", `${location.pathname}?${params.toString()}${location.hash}`);
    render();
    listTitle?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  monthViewButton?.addEventListener("click", () => {
    selectedDate = "";
    history.replaceState(null, "", `${location.pathname}${location.hash}`);
    render();
  });
  todayViewButton?.addEventListener("click", () => {
    selectedDate = tokyoToday;
    const date = toDate(tokyoToday);
    if (date) view = new Date(date.getFullYear(), date.getMonth(), 1);
    history.replaceState(null, "", `${location.pathname}?date=${encodeURIComponent(tokyoToday)}${location.hash}`);
    render();
  });
  prev.addEventListener("click", () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); selectedDate = ""; render(); });
  next.addEventListener("click", () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); selectedDate = ""; render(); });

  list.addEventListener("click", (event) => {
    const button = event.target.closest(".event-ics-button");
    if (!button) return;
    const currentEvents = eventsForYears(view.getFullYear() - 1, view.getFullYear(), view.getFullYear() + 1);
    const selected = currentEvents.find((item) => String(item.id || "") === String(button.dataset.eventId || ""));
    if (selected) {
      downloadEventIcs(selected);
      window.RESCENE_ANALYTICS?.track?.("calendar_add", { method: "ics", event_title: selected.title || "" });
    }
  });
  list.addEventListener("click", (event) => {
    const link = event.target.closest("[data-calendar-add=google]");
    if (!link) return;
    const selected = eventsForYears(view.getFullYear() - 1, view.getFullYear(), view.getFullYear() + 1).find((item) => String(item.id || "") === String(link.dataset.eventId || ""));
    window.RESCENE_ANALYTICS?.track?.("calendar_add", { method: "google", event_title: selected?.title || "" });
  });

  const subscribeButton = document.getElementById("googleCalendarSubscribe");
  const subscribeStatus = document.getElementById("calendarSubscribeStatus");
  subscribeButton?.addEventListener("click", async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(calendarFeedUrl);
      copied = true;
    } catch {
      const input = document.createElement("textarea");
      input.value = calendarFeedUrl;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      copied = document.execCommand("copy");
      input.remove();
    }
    if (subscribeStatus) subscribeStatus.textContent = copied
      ? "購読URLをコピーしました。開いたGoogleカレンダーの「URLで追加」欄へ貼り付けてください。"
      : `このURLをGoogleカレンダーの「URLで追加」へ貼り付けてください：${calendarFeedUrl}`;
    window.open("https://calendar.google.com/calendar/u/0/r/settings/addbyurl", "_blank", "noopener,noreferrer");
  });

  render();
})();
