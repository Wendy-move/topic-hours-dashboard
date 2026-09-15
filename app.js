(function () {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const AUTO_REFRESH_MS = 30 * 1000;
  const TOPIC_COLORS = [
    "#e7463f",
    "#3d6f8d",
    "#2e8062",
    "#ad6b2f",
    "#7563a4",
    "#4f7c78",
    "#936075",
    "#657268",
    "#8a6b3d"
  ];

  const elements = {
    sourceState: document.getElementById("sourceState"),
    sourceLabel: document.getElementById("sourceLabel"),
    refreshButton: document.getElementById("refreshButton"),
    previousWeek: document.getElementById("previousWeek"),
    nextWeek: document.getElementById("nextWeek"),
    currentWeek: document.getElementById("currentWeek"),
    weekPickerButton: document.getElementById("weekPickerButton"),
    weekCaption: document.getElementById("weekCaption"),
    weekRange: document.getElementById("weekRange"),
    weekDialog: document.getElementById("weekDialog"),
    weekDateInput: document.getElementById("weekDateInput"),
    applyWeek: document.getElementById("applyWeek"),
    lastSync: document.getElementById("lastSync"),
    totalHours: document.getElementById("totalHours"),
    totalMinutes: document.getElementById("totalMinutes"),
    topicCount: document.getElementById("topicCount"),
    eventCount: document.getElementById("eventCount"),
    topTopic: document.getElementById("topTopic"),
    topTopicTime: document.getElementById("topTopicTime"),
    distribution: document.getElementById("distribution"),
    workspaceEyebrow: document.getElementById("workspaceEyebrow"),
    searchInput: document.getElementById("searchInput"),
    clearSearch: document.getElementById("clearSearch"),
    topicTab: document.getElementById("topicTab"),
    dayTab: document.getElementById("dayTab"),
    topicPanel: document.getElementById("topicPanel"),
    dayPanel: document.getElementById("dayPanel"),
    topicTableBody: document.getElementById("topicTableBody"),
    dayList: document.getElementById("dayList"),
    loadingState: document.getElementById("loadingState"),
    emptyState: document.getElementById("emptyState"),
    errorNotice: document.getElementById("errorNotice"),
    errorText: document.getElementById("errorText"),
    calendarName: document.getElementById("calendarName"),
    footerSummary: document.getElementById("footerSummary"),
    toast: document.getElementById("toast")
  };

  const state = {
    weekStart: getMonday(new Date()),
    payload: null,
    parsedEvents: [],
    groups: [],
    query: "",
    view: "topic",
    loading: false,
    initialized: false,
    toastTimer: null
  };

  function getMonday(input) {
    const date = new Date(input.getFullYear(), input.getMonth(), input.getDate(), 12);
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return date;
  }

  function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
  }

  function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function sameDay(left, right) {
    return dateKey(left) === dateKey(right);
  }

  function formatWeekRange(start) {
    const end = addDays(start, 4);
    if (start.getMonth() === end.getMonth()) {
      return `${start.getMonth() + 1}月${start.getDate()}日 - ${end.getDate()}日`;
    }
    return `${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`;
  }

  function formatDuration(minutes) {
    const rounded = Math.round(Number(minutes) || 0);
    if (rounded <= 0) return "0分";
    const hours = Math.floor(rounded / 60);
    const remainder = rounded % 60;
    if (!hours) return `${remainder}分`;
    if (!remainder) return `${hours}小时`;
    return `${hours}小时${remainder}分`;
  }

  function formatClock(date) {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(date);
  }

  function formatSyncTime(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "刚刚同步";
    const today = new Date();
    const prefix = sameDay(date, today)
      ? "今天"
      : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
    return `${prefix} ${formatClock(date)} 同步`;
  }

  function normalizeEvent(event) {
    const startValue = event.start || event.start_time?.timestamp || event.startTime;
    const endValue = event.end || event.end_time?.timestamp || event.endTime;
    const start = /^\d{9,}$/.test(String(startValue || ""))
      ? new Date(Number(startValue) * 1000)
      : new Date(startValue);
    const end = /^\d{9,}$/.test(String(endValue || ""))
      ? new Date(Number(endValue) * 1000)
      : new Date(endValue);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
    return {
      id: String(event.id || event.event_id || `${event.summary}-${start.toISOString()}`),
      summary: String(event.summary || "未命名日程").trim(),
      start,
      end,
      minutes: Math.round((end.getTime() - start.getTime()) / 60000)
    };
  }

  function parseTitle(event, payload) {
    const mapping = payload.titleMappings?.[event.summary];
    let topic;
    let issue;

    if (mapping) {
      topic = mapping.topic;
      issue = mapping.issue;
    } else {
      const match = event.summary.match(/^(.+?)[\-－—–](.+)$/);
      if (match) {
        topic = match[1].trim();
        issue = match[2].trim();
      } else {
        topic = "其他事务";
        issue = event.summary;
      }
    }

    const canonicalTopic = payload.topicAliases?.[topic] || topic;
    return { ...event, topic: canonicalTopic, originalTopic: topic, issue };
  }

  function eventsForWeek(events, weekStart) {
    const rangeStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
    const rangeEnd = new Date(addDays(weekStart, 5));
    return events.filter((event) => event.start >= rangeStart && event.start < rangeEnd);
  }

  function groupEvents(events) {
    const topicMap = new Map();

    events.forEach((event) => {
      if (!topicMap.has(event.topic)) {
        topicMap.set(event.topic, {
          topic: event.topic,
          minutes: 0,
          count: 0,
          firstStart: event.start,
          issues: new Map()
        });
      }
      const topic = topicMap.get(event.topic);
      topic.minutes += event.minutes;
      topic.count += 1;
      if (event.start < topic.firstStart) topic.firstStart = event.start;

      if (!topic.issues.has(event.issue)) {
        topic.issues.set(event.issue, {
          name: event.issue,
          minutes: 0,
          count: 0,
          firstStart: event.start,
          dates: []
        });
      }
      const issue = topic.issues.get(event.issue);
      issue.minutes += event.minutes;
      issue.count += 1;
      if (event.start < issue.firstStart) issue.firstStart = event.start;
      issue.dates.push(event.start);
    });

    return Array.from(topicMap.values())
      .map((topic) => ({
        ...topic,
        issues: Array.from(topic.issues.values()).sort((a, b) => a.firstStart - b.firstStart)
      }))
      .sort((a, b) => b.minutes - a.minutes || a.firstStart - b.firstStart);
  }

  function topicColor(index) {
    return TOPIC_COLORS[index % TOPIC_COLORS.length];
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function createElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function filteredGroups() {
    const query = state.query.trim().toLocaleLowerCase("zh-CN");
    if (!query) return state.groups;

    return state.groups
      .map((group) => {
        if (group.topic.toLocaleLowerCase("zh-CN").includes(query)) return group;
        const issues = group.issues.filter((issue) => issue.name.toLocaleLowerCase("zh-CN").includes(query));
        return issues.length ? { ...group, issues } : null;
      })
      .filter(Boolean);
  }

  function filteredEvents() {
    const query = state.query.trim().toLocaleLowerCase("zh-CN");
    if (!query) return state.parsedEvents;
    return state.parsedEvents.filter((event) =>
      `${event.topic} ${event.issue}`.toLocaleLowerCase("zh-CN").includes(query)
    );
  }

  function renderOverview() {
    const total = state.parsedEvents.reduce((sum, event) => sum + event.minutes, 0);
    const top = state.groups[0];
    elements.totalHours.textContent = `${Math.round(total / 60)}小时`;
    elements.totalMinutes.textContent = `${state.parsedEvents.length}项日程`;
    elements.topicCount.textContent = String(state.groups.length);
    elements.eventCount.textContent = String(state.parsedEvents.length);
    elements.topTopic.textContent = top?.topic || "--";
    elements.topTopicTime.textContent = top ? `${formatDuration(top.minutes)} · ${top.count}项` : "--";

    clearNode(elements.distribution);
    const heading = createElement("div", "distribution-title");
    heading.append(createElement("span", "", "课题耗时占比"));
    heading.append(createElement("span", "", total ? `${state.groups.length}个课题` : "暂无投入"));
    elements.distribution.append(heading);

    const bar = createElement("div", "distribution-bar");
    state.groups.forEach((group, index) => {
      const segment = createElement("span");
      segment.style.width = total ? `${(group.minutes / total) * 100}%` : "0";
      segment.style.background = topicColor(index);
      segment.title = `${group.topic} ${formatDuration(group.minutes)}`;
      bar.append(segment);
    });
    elements.distribution.append(bar);

    const legend = createElement("div", "distribution-legend");
    state.groups.slice(0, 5).forEach((group, index) => {
      const item = createElement("span", "legend-item");
      const color = createElement("span", "legend-color");
      color.style.background = topicColor(index);
      item.append(color, createElement("span", "", `${group.topic} ${formatDuration(group.minutes)}`));
      legend.append(item);
    });
    elements.distribution.append(legend);
  }

  function renderTopicTable() {
    const groups = filteredGroups();
    clearNode(elements.topicTableBody);

    groups.forEach((group) => {
      const originalIndex = state.groups.findIndex((item) => item.topic === group.topic);
      const row = document.createElement("tr");

      const topicCell = createElement("td", "topic-cell");
      topicCell.style.setProperty("--topic-color", topicColor(originalIndex));
      topicCell.append(
        createElement("span", "topic-name", group.topic),
        createElement("span", "topic-meta", `${group.count}项日程`)
      );

      const issueCell = document.createElement("td");
      const issueLines = createElement("div", "issue-lines");
      group.issues.forEach((issue) => {
        const line = createElement("div", "issue-line");
        line.append(createElement("span", "issue-name", issue.name));
        if (issue.count > 1) line.append(createElement("span", "occurrence", `${issue.count}次`));
        issueLines.append(line);
      });
      issueCell.append(issueLines);

      const durationCell = document.createElement("td");
      const durationLines = createElement("div", "duration-lines");
      group.issues.forEach((issue) => {
        durationLines.append(createElement("div", "duration-line", formatDuration(issue.minutes)));
      });
      durationCell.append(durationLines);

      const totalCell = createElement("td", "topic-total", formatDuration(group.minutes));
      row.append(topicCell, issueCell, durationCell, totalCell);
      elements.topicTableBody.append(row);
    });
  }

  function renderDayList() {
    const events = [...filteredEvents()].sort((a, b) => a.start - b.start);
    const days = new Map();
    events.forEach((event) => {
      const key = dateKey(event.start);
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(event);
    });
    clearNode(elements.dayList);

    days.forEach((dayEvents) => {
      const date = dayEvents[0].start;
      const group = createElement("section", "day-group");
      const heading = createElement("div", "day-heading");
      heading.append(
        createElement("strong", "", new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(date)),
        createElement("span", "", `${date.getMonth() + 1}月${date.getDate()}日 · ${formatDuration(dayEvents.reduce((sum, e) => sum + e.minutes, 0))}`)
      );

      const list = createElement("div", "day-events");
      dayEvents.forEach((event) => {
        const topicIndex = state.groups.findIndex((item) => item.topic === event.topic);
        const item = createElement("article", "day-event");
        item.append(createElement("time", "event-time", formatClock(event.start)));
        const main = createElement("div", "event-main");
        main.style.setProperty("--topic-color", topicColor(topicIndex));
        const copy = createElement("div", "event-copy");
        copy.append(createElement("strong", "", event.issue), createElement("small", "", event.topic));
        main.append(copy);
        item.append(main, createElement("span", "event-duration", formatDuration(event.minutes)));
        list.append(item);
      });

      group.append(heading, list);
      elements.dayList.append(group);
    });
  }

  function renderDataState() {
    const payload = state.payload || {};
    const isLive = payload.source === "live";
    const isScheduled = payload.source === "scheduled";
    elements.sourceState.classList.toggle("snapshot", !isLive && !isScheduled);
    elements.sourceState.classList.remove("error");
    elements.sourceLabel.textContent = isLive ? "实时数据" : isScheduled ? "自动同步" : "本地快照";
    elements.sourceState.title = elements.sourceLabel.textContent;
    elements.lastSync.querySelector("span").textContent = formatSyncTime(payload.fetchedAt);
    elements.workspaceEyebrow.textContent = payload.calendar?.name || "红色日历";
    elements.calendarName.textContent = payload.calendar?.name || "红色日历";
    elements.footerSummary.textContent = `${state.parsedEvents.length}条日程 · 周一至周五`;
    if (payload.calendar?.color) {
      document.documentElement.style.setProperty("--red", payload.calendar.color);
    }

    if (payload.warning) {
      elements.errorText.textContent = String(payload.warning).startsWith("Live sync failed")
        ? "实时同步失败，当前已回退到最近一次日历快照。"
        : `当前为日历快照，数据截至 ${formatSyncTime(payload.fetchedAt).replace(" 同步", "")}。`;
      elements.errorNotice.hidden = false;
    } else {
      elements.errorNotice.hidden = true;
    }
  }

  function renderWeekLabel() {
    const currentMonday = getMonday(new Date());
    elements.weekCaption.textContent = sameDay(state.weekStart, currentMonday)
      ? "本周"
      : `${state.weekStart.getFullYear()}年`;
    elements.weekRange.textContent = formatWeekRange(state.weekStart);
    elements.weekDateInput.value = dateKey(state.weekStart);
  }

  function renderViews() {
    const hasResults = state.view === "topic" ? filteredGroups().length > 0 : filteredEvents().length > 0;
    elements.topicPanel.hidden = state.view !== "topic" || !hasResults;
    elements.dayPanel.hidden = state.view !== "day" || !hasResults;
    elements.emptyState.hidden = hasResults;
    elements.topicTab.classList.toggle("active", state.view === "topic");
    elements.dayTab.classList.toggle("active", state.view === "day");
    elements.topicTab.setAttribute("aria-selected", String(state.view === "topic"));
    elements.dayTab.setAttribute("aria-selected", String(state.view === "day"));
    renderTopicTable();
    renderDayList();
  }

  function render() {
    renderWeekLabel();
    renderOverview();
    renderDataState();
    renderViews();
    if (window.lucide) window.lucide.createIcons();
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 2400);
  }

  async function requestPayload() {
    const isStaticDeployment = /(?:\.github\.io|\.pages\.dev)$/i.test(window.location.hostname);
    if (isStaticDeployment) {
      const response = await fetch("./calendar-data.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`日历快照返回 ${response.status}`);
      return await response.json();
    }

    const apiUrl = `/api/calendar?weekStart=${encodeURIComponent(dateKey(state.weekStart))}`;
    try {
      const response = await fetch(apiUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`日历服务返回 ${response.status}`);
      return await response.json();
    } catch (apiError) {
      const fallback = await fetch("./calendar-data.json", { cache: "no-store" });
      if (!fallback.ok) throw apiError;
      const payload = await fallback.json();
      if (payload.source !== "scheduled") {
        payload.warning = "实时服务暂不可用，当前展示已保存的日历快照。";
        payload.source = "snapshot";
      }
      return payload;
    }
  }

  async function loadData(options = {}) {
    if (state.loading) return;
    state.loading = true;
    elements.refreshButton.classList.add("syncing");
    elements.refreshButton.disabled = true;
    elements.errorNotice.hidden = true;

    if (!state.initialized && !options.silent) {
      elements.loadingState.hidden = false;
      elements.topicPanel.hidden = true;
      elements.dayPanel.hidden = true;
      elements.emptyState.hidden = true;
    }

    try {
      const payload = await requestPayload();
      const normalized = (payload.events || []).map(normalizeEvent).filter(Boolean);
      state.payload = payload;
      state.parsedEvents = eventsForWeek(normalized, state.weekStart)
        .map((event) => parseTitle(event, payload))
        .sort((a, b) => a.start - b.start);
      state.groups = groupEvents(state.parsedEvents);
      state.initialized = true;
      render();
      if (options.announce) showToast(payload.source === "live" ? "已同步最新日历" : "已刷新本地快照");
    } catch (error) {
      elements.errorText.textContent = error instanceof Error ? error.message : "日历读取失败";
      elements.errorNotice.hidden = false;
      elements.sourceState.classList.add("error");
      elements.sourceLabel.textContent = "同步失败";
      if (!state.initialized) {
        elements.emptyState.hidden = false;
        elements.emptyState.querySelector("strong").textContent = "无法读取日历";
        elements.emptyState.querySelector("span").textContent = "请确认本地服务正在运行";
      }
    } finally {
      state.loading = false;
      elements.loadingState.hidden = true;
      elements.refreshButton.classList.remove("syncing");
      elements.refreshButton.disabled = false;
    }
  }

  function setWeek(date) {
    state.weekStart = getMonday(date);
    state.query = "";
    elements.searchInput.value = "";
    elements.clearSearch.hidden = true;
    renderWeekLabel();
    loadData();
  }

  function setView(view) {
    state.view = view;
    renderViews();
  }

  elements.previousWeek.addEventListener("click", () => setWeek(addDays(state.weekStart, -7)));
  elements.nextWeek.addEventListener("click", () => setWeek(addDays(state.weekStart, 7)));
  elements.currentWeek.addEventListener("click", () => setWeek(new Date()));
  elements.refreshButton.addEventListener("click", () => loadData({ silent: true, announce: true }));
  elements.topicTab.addEventListener("click", () => setView("topic"));
  elements.dayTab.addEventListener("click", () => setView("day"));

  elements.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    elements.clearSearch.hidden = !state.query;
    renderViews();
  });

  elements.clearSearch.addEventListener("click", () => {
    state.query = "";
    elements.searchInput.value = "";
    elements.clearSearch.hidden = true;
    elements.searchInput.focus();
    renderViews();
  });

  elements.weekPickerButton.addEventListener("click", () => {
    elements.weekDateInput.value = dateKey(state.weekStart);
    elements.weekDialog.showModal();
  });

  elements.applyWeek.addEventListener("click", (event) => {
    event.preventDefault();
    if (!elements.weekDateInput.value) return;
    const selected = new Date(`${elements.weekDateInput.value}T12:00:00`);
    elements.weekDialog.close();
    setWeek(selected);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.initialized) loadData({ silent: true });
  });

  window.setInterval(() => {
    loadData({ silent: true });
  }, AUTO_REFRESH_MS);

  renderWeekLabel();
  loadData();
})();
