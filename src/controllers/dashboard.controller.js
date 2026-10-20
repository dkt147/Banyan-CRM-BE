import { asyncHandler } from "../utils/asyncHandler.js";
import { Deal } from "../models/Deal.js";
import { Task } from "../models/Task.js";
import { Conversation } from "../models/Conversation.js";
import { Invoice } from "../models/Invoice.js";
import { Membership } from "../models/Membership.js";
import { LoyaltyAccount } from "../models/LoyaltyAccount.js";
import { Pipeline } from "../models/Pipeline.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { Workspace } from "../models/Workspace.js";
import { Booking } from "../models/Booking.js";
import { Message } from "../models/Message.js";
import { env } from "../config/env.js";
export const overview = asyncHandler(async (req, res) => {
  const w = req.workspaceId;
  const [pipeline, openDeals, tasks, unread, invoices, memberships, loyalty] =
    await Promise.all([
      Deal.aggregate([
        { $match: { workspaceId: w, status: "open" } },
        {
          $group: { _id: null, value: { $sum: "$value" }, count: { $sum: 1 } },
        },
      ]),
      Deal.countDocuments({ workspaceId: w, status: "open" }),
      Task.countDocuments({
        workspaceId: w,
        status: { $in: ["pending", "in_progress"] },
      }),
      Conversation.aggregate([
        { $match: { workspaceId: w, unreadCount: { $gt: 0 } } },
        { $group: { _id: null, count: { $sum: "$unreadCount" } } },
      ]),
      Invoice.aggregate([
        {
          $match: { workspaceId: w, status: { $in: ["awaiting", "overdue"] } },
        },
        {
          $group: { _id: null, total: { $sum: "$total" }, count: { $sum: 1 } },
        },
      ]),
      Membership.countDocuments({ workspaceId: w, status: "active" }),
      LoyaltyAccount.countDocuments({ workspaceId: w }),
    ]);
  res.json({
    success: true,
    data: {
      openPipeline: pipeline[0] || { value: 0, count: 0 },
      openDeals,
      tasksNeedingAction: tasks,
      unreadMessages: unread[0]?.count || 0,
      awaitingInvoices: invoices[0] || { total: 0, count: 0 },
      activeMemberships: memberships,
      enrolledLoyaltyClients: loyalty,
    },
  });
});
export const pipeline = asyncHandler(async (req, res) => {
  const rows = await Deal.aggregate([
    { $match: { workspaceId: req.workspaceId, status: "open" } },
    {
      $group: {
        _id: "$stageId",
        value: { $sum: "$value" },
        count: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: "pipelinestages",
        localField: "_id",
        foreignField: "_id",
        as: "stage",
      },
    },
    { $unwind: "$stage" },
    {
      $project: {
        stageId: "$_id",
        name: "$stage.name",
        value: 1,
        count: 1,
        _id: 0,
      },
    },
    { $sort: { "stage.sortOrder": 1 } },
  ]);
  res.json({ success: true, data: rows });
});
export const revenue = asyncHandler(async (req, res) => {
  const rows = await Invoice.aggregate([
    { $match: { workspaceId: req.workspaceId, status: "paid" } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$paidAt" } },
        revenue: { $sum: "$total" },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  res.json({ success: true, data: rows });
});


const QUIET_DEAL_DAYS = 5;
const RENEWAL_WINDOW_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(
    parts.filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function localMidnightAsUtc(calendarDate, timeZone) {
  const target = Date.UTC(
    calendarDate.getUTCFullYear(),
    calendarDate.getUTCMonth(),
    calendarDate.getUTCDate(),
  );
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = zonedParts(new Date(guess), timeZone);
    const represented = Date.UTC(
      local.year, local.month - 1, local.day, local.hour, local.minute, local.second,
    );
    const correction = target - represented;
    guess += correction;
    if (correction === 0) break;
  }
  return new Date(guess);
}

function dateRanges(timeZone, now = new Date()) {
  const parts = zonedParts(now, timeZone);
  const today = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const nextMonday = new Date(today);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + (7 - ((today.getUTCDay() + 6) % 7)));
  const monthStart = new Date(Date.UTC(parts.year, parts.month - 1, 1));
  const nextMonthStart = new Date(Date.UTC(parts.year, parts.month, 1));
  const previousMonthStart = new Date(Date.UTC(parts.year, parts.month - 2, 1));
  return {
    now,
    startOfToday: localMidnightAsUtc(today, timeZone),
    startOfTomorrow: localMidnightAsUtc(tomorrow, timeZone),
    startOfNextWeek: localMidnightAsUtc(nextMonday, timeZone),
    startOfMonth: localMidnightAsUtc(monthStart, timeZone),
    startOfNextMonth: localMidnightAsUtc(nextMonthStart, timeZone),
    startOfPreviousMonth: localMidnightAsUtc(previousMonthStart, timeZone),
  };
}

function safeTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value || "Asia/Hong_Kong" }).format(new Date());
    return value || "Asia/Hong_Kong";
  } catch {
    return "Asia/Hong_Kong";
  }
}

function productCategory(productType = "", fallback = "") {
  const value = `${productType} ${fallback}`.toLowerCase();
  if (/venue|event|photo|podcast|studio|hire/.test(value)) return "Venue & studio";
  if (/meeting.?room|meeting room/.test(value)) return "Meeting rooms";
  if (/day.?pass|day pass/.test(value)) return "Day passes";
  if (/membership|cowork|private.?office|private office|office/.test(value)) return "Memberships";
  return "Other services";
}

function sourceBucket(source = "") {
  const value = String(source).toLowerCase().trim();
  if (/website|web form|wordpress|site/.test(value)) return "Website";
  if (/referr|member referral|word.of.mouth/.test(value)) return "Referral";
  if (/broker|agent/.test(value)) return "Broker";
  if (/instagram|social|facebook|linkedin/.test(value)) return "Instagram";
  return value ? "Other" : "Unknown";
}

function contactName(contact) {
  if (!contact) return "";
  return `${contact.firstName || ""} ${contact.lastName || ""}`.trim();
}

/**
 * Consolidated dashboard payload used by the reference dashboard screen.
 * All reads are scoped to the authenticated user's workspace.
 */
export const complete = asyncHandler(async (req, res) => {
  const workspaceId = req.workspaceId;
  const workspace = await Workspace.findById(workspaceId).select("timezone currency name").lean();
  const timezone = safeTimeZone(workspace?.timezone);
  const ranges = dateRanges(timezone);
  const quietCutoff = new Date(ranges.now.getTime() - QUIET_DEAL_DAYS * DAY_MS);
  const renewalCutoff = new Date(ranges.now.getTime() + RENEWAL_WINDOW_DAYS * DAY_MS);
  const sourceCutoff = new Date(ranges.now.getTime() - 90 * DAY_MS);
  const activeTaskStatuses = ["pending", "in_progress"];

  const [
    pipelines,
    stages,
    stageAggregates,
    overdueTasks,
    invoiceCounts,
    renewalMemberships,
    activeMemberships,
    todayQueueRows,
    conversations,
    inboxCounts,
    lastMonthInvoices,
    sourceDeals,
    quietDeals,
    quietDealCount,
    upcomingBookings,
    previousPipelineRows,
  ] = await Promise.all([
    Pipeline.find({ workspaceId, isActive: true, key: { $in: ["membership", "private-office", "venue-hire", "transactional"] } }).sort({ sortOrder: 1, createdAt: 1 }).lean(),
    PipelineStage.find({ workspaceId, isActive: true }).sort({ pipelineId: 1, sortOrder: 1 }).lean(),
    Deal.aggregate([
      { $match: { workspaceId, status: "open" } },
      { $group: { _id: { pipelineId: "$pipelineId", stageId: "$stageId" }, value: { $sum: "$value" }, count: { $sum: 1 } } },
    ]),
    Task.countDocuments({
      workspaceId,
      status: { $nin: ["completed", "cancelled"] },
      dueAt: { $lt: ranges.startOfToday },
      $and: [{ $or: [{ status: { $ne: "snoozed" } }, { status: "snoozed", snoozedUntil: { $lte: ranges.now } }] }],
    }),
    Promise.all([
      Invoice.countDocuments({ workspaceId, status: "awaiting" }),
      Invoice.countDocuments({ workspaceId, status: "overdue" }),
      Invoice.aggregate([
        { $match: { workspaceId, status: { $in: ["awaiting", "overdue"] } } },
        { $group: { _id: null, total: { $sum: "$total" }, count: { $sum: 1 } } },
      ]),
    ]),
    Membership.find({
      workspaceId,
      status: "active",
      $or: [
        { renewalAt: { $gte: ranges.now, $lte: renewalCutoff } },
        { endAt: { $gte: ranges.now, $lte: renewalCutoff } },
      ],
    }).select("monthlyValue renewalAt endAt contactId").lean(),
    Membership.find({ workspaceId, status: "active" })
      .populate("planId", "name type")
      .select("seats monthlyValue planId renewalAt endAt")
      .lean(),
    Task.find({
      workspaceId,
      status: { $in: activeTaskStatuses },
      dueAt: { $gte: new Date(ranges.now.getTime() - 7 * DAY_MS), $lt: ranges.startOfTomorrow },
      $or: [{ createdBy: req.user._id }, { assignedTo: req.user._id }],
    })
      .populate("contactId", "firstName lastName")
      .populate("companyId", "name")
      .populate("dealId", "title value productType")
      .sort({ dueAt: 1 })
      .limit(5)
      .lean(),
    Conversation.find({ workspaceId, status: "open" })
      .populate("contactId", "firstName lastName email")
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .limit(4)
      .lean(),
    Promise.all([
      Conversation.countDocuments({ workspaceId, status: "open" }),
      Conversation.countDocuments({ workspaceId, status: "open", channel: "email" }),
      Conversation.countDocuments({ workspaceId, status: "open", channel: "whatsapp" }),
      Conversation.aggregate([
        { $match: { workspaceId, status: "open", unreadCount: { $gt: 0 } } },
        { $group: { _id: null, count: { $sum: "$unreadCount" } } },
      ]),
    ]),
    Invoice.find({
      workspaceId,
      status: "paid",
      paidAt: { $gte: ranges.startOfPreviousMonth, $lt: ranges.startOfMonth },
    }).select("total currency dealId description metadata paidAt").populate("dealId", "productType title").lean(),
    Deal.find({ workspaceId, createdAt: { $gte: sourceCutoff }, source: { $exists: true, $ne: "" } })
      .select("source status")
      .lean(),
    Deal.find({
      workspaceId,
      status: "open",
      $expr: {
        $lte: [
          { $ifNull: ["$lastActivityAt", { $ifNull: ["$updatedAt", "$createdAt"] }] },
          quietCutoff,
        ],
      },
    }).populate("contactId", "firstName lastName").populate("stageId", "name").sort({ value: -1 }).limit(3).lean(),
    Deal.countDocuments({
      workspaceId,
      status: "open",
      $expr: {
        $lte: [
          { $ifNull: ["$lastActivityAt", { $ifNull: ["$updatedAt", "$createdAt"] }] },
          quietCutoff,
        ],
      },
    }),
    Booking.find({
      workspaceId,
      status: { $in: ["pending", "confirmed", "held"] },
      startAt: { $gte: ranges.startOfToday, $lt: renewalCutoff },
    }).sort({ startAt: 1 }).limit(6).populate("contactId", "firstName lastName").lean(),
    // Open pipeline as it stood ~30 days ago: deals that already existed then and were
    // either still open or only closed (won/lost) after that point.
    Deal.aggregate([
      {
        $match: {
          workspaceId,
          createdAt: { $lte: new Date(ranges.now.getTime() - 30 * DAY_MS) },
          $or: [
            { status: "open" },
            { status: { $in: ["won", "lost"] }, updatedAt: { $gt: new Date(ranges.now.getTime() - 30 * DAY_MS) } },
          ],
        },
      },
      { $group: { _id: null, value: { $sum: "$value" }, count: { $sum: 1 } } },
    ]),
  ]);

  const pipelineById = new Map(pipelines.map((pipeline) => [String(pipeline._id), {
    pipelineId: pipeline._id,
    key: pipeline.key,
    name: pipeline.name,
    sortOrder: pipeline.sortOrder,
    value: 0,
    count: 0,
    stages: [],
  }]));
  const aggregateByKey = new Map(stageAggregates.map((row) => [`${row._id.pipelineId}:${row._id.stageId}`, row]));
  for (const stage of stages) {
    const pipeline = pipelineById.get(String(stage.pipelineId));
    if (!pipeline) continue;
    const aggregate = aggregateByKey.get(`${stage.pipelineId}:${stage._id}`);
    const count = aggregate?.count || 0;
    const value = aggregate?.value || 0;
    pipeline.stages.push({
      stageId: stage._id,
      name: stage.name,
      sortOrder: stage.sortOrder,
      count,
      value,
    });
    pipeline.count += count;
    pipeline.value += value;
  }
  const pipelineCards = [...pipelineById.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  const openPipelineValue = pipelineCards.reduce((sum, item) => sum + item.value, 0);
  const openDealCount = pipelineCards.reduce((sum, item) => sum + item.count, 0);
  const previousPipelineValue = Number(previousPipelineRows[0]?.value || 0);
  const pipelineChangePercent = previousPipelineValue > 0
    ? Math.round(((openPipelineValue - previousPipelineValue) / previousPipelineValue) * 100)
    : null;

  const deskCapacity = env.DASHBOARD_DESK_CAPACITY > 0 ? env.DASHBOARD_DESK_CAPACITY : null;
  const officeCapacity = env.DASHBOARD_OFFICE_CAPACITY > 0 ? env.DASHBOARD_OFFICE_CAPACITY : null;
  let occupiedDesks = 0;
  let occupiedOffices = 0;
  for (const membership of activeMemberships) {
    const planText = `${membership.planId?.type || ""} ${membership.planId?.name || ""}`.toLowerCase();
    const seats = Math.max(1, Number(membership.seats || 1));
    if (/office/.test(planText)) occupiedOffices += 1;
    else if (/desk|cowork|membership|member/.test(planText)) occupiedDesks += seats;
  }
  const deskPercent = deskCapacity ? Math.min(100, Math.round((occupiedDesks / deskCapacity) * 100)) : null;
  const officePercent = officeCapacity ? Math.min(100, Math.round((occupiedOffices / officeCapacity) * 100)) : null;
  const hasAnyCapacity = Boolean(deskCapacity && officeCapacity);
  const occupiedTotal = occupiedDesks + occupiedOffices;
  const capacityTotal = (deskCapacity || 0) + (officeCapacity || 0);
  const overallOccupancyPercent = deskCapacity && officeCapacity && capacityTotal ? Math.min(100, Math.round((occupiedTotal / capacityTotal) * 100)) : null;

  const renewals = renewalMemberships.reduce((sum, item) => sum + Number(item.monthlyValue || 0), 0);
  const [awaitingInvoiceCount, overdueInvoiceCount, awaitingInvoiceAggregate] = invoiceCounts;
  const [openConversationCount, emailConversationCount, whatsappConversationCount, unreadConversationAggregate] = inboxCounts;
  const unpaidInvoiceCount = awaitingInvoiceCount + overdueInvoiceCount;
  const needsActionTotal = overdueTasks + unpaidInvoiceCount + quietDealCount;

  const latestMessageRows = conversations.length
    ? await Message.aggregate([
        { $match: { workspaceId, conversationId: { $in: conversations.map((item) => item._id) } } },
        { $sort: { sentAt: -1 } },
        { $group: { _id: "$conversationId", preview: { $first: "$body" }, messageCount: { $sum: 1 } } },
      ])
    : [];
  const previewByConversationId = new Map(latestMessageRows.map((item) => [String(item._id), item.preview]));
  const messageCountByConversationId = new Map(latestMessageRows.map((item) => [String(item._id), item.messageCount]));
  const inbox = conversations.map((item) => ({
    _id: item._id,
    channel: item.channel,
    subject: item.subject || "",
    participantName: item.participantName || contactName(item.contactId) || item.participantAddress || "Conversation",
    participantAddress: item.participantAddress || item.contactId?.email || "",
    status: item.status,
    unreadCount: item.unreadCount || 0,
    lastMessageAt: item.lastMessageAt,
    preview: previewByConversationId.get(String(item._id)) || item.subject || "Open conversation",
    messageCount: messageCountByConversationId.get(String(item._id)) || 0,
    aiSummarised: Boolean(item.metadata?.aiSummary || item.metadata?.summary),
  }));

  const revenueByCategory = new Map([
    ["Memberships", 0],
    ["Venue & studio", 0],
    ["Meeting rooms", 0],
    ["Day passes", 0],
    ["Other services", 0],
  ]);
  for (const invoice of lastMonthInvoices) {
    const category = productCategory(invoice.dealId?.productType || invoice.metadata?.productType || "", `${invoice.description || ""} ${invoice.dealId?.title || ""}`);
    revenueByCategory.set(category, (revenueByCategory.get(category) || 0) + Number(invoice.total || 0));
  }
  const revenueMix = [...revenueByCategory.entries()].map(([category, amount]) => ({ category, revenue: amount }));
  const previousMonthLabel = new Intl.DateTimeFormat("en-HK", { timeZone: timezone, month: "long" }).format(new Date(ranges.startOfPreviousMonth.getTime() + 12 * 60 * 60 * 1000));

  const sourceMap = new Map();
  for (const deal of sourceDeals) {
    const key = sourceBucket(deal.source);
    const current = sourceMap.get(key) || { source: key, count: 0, wonCount: 0 };
    current.count += 1;
    if (deal.status === "won") current.wonCount += 1;
    sourceMap.set(key, current);
  }
  const sourceTotal = [...sourceMap.values()].reduce((sum, item) => sum + item.count, 0);
  const sourceOrder = ["Website", "Referral", "Broker", "Instagram", "Other", "Unknown"];
  const leadSources = [...sourceMap.values()]
    .sort((a, b) => sourceOrder.indexOf(a.source) - sourceOrder.indexOf(b.source))
    .map((item) => ({
      ...item,
      percentage: sourceTotal ? Math.round((item.count / sourceTotal) * 100) : 0,
      conversionRate: item.count ? Math.round((item.wonCount / item.count) * 100) : 0,
    }));

  const topQuietDeal = quietDeals[0];
  const currencyCode = workspace?.currency || "HKD";
  const money = (amount) => `${currencyCode === "HKD" ? "HK$" : `${currencyCode} `}${Number(amount || 0).toLocaleString("en-HK", { maximumFractionDigits: 0 })}`;
  const quietDaysOf = (deal) => Math.max(
    QUIET_DEAL_DAYS,
    Math.floor((ranges.now.getTime() - new Date(deal.lastActivityAt || deal.updatedAt || deal.createdAt).getTime()) / DAY_MS),
  );
  const insight = topQuietDeal
    ? (() => {
        const person = contactName(topQuietDeal.contactId);
        const stageName = topQuietDeal.stageId?.name || "";
        const quietDays = quietDaysOf(topQuietDeal);
        const firstName = (person || "there").split(/\s+/)[0];
        return {
          title: "A deal may need a follow-up",
          message: `${person || topQuietDeal.title} has gone quiet for ${quietDays} days${stageName ? ` at the ${stageName} stage` : ""}, with ${money(topQuietDeal.value)} on the table. A short, personal follow-up now is the best way to keep it moving.`,
          dealId: topQuietDeal._id,
          contactId: topQuietDeal.contactId?._id || null,
          dealTitle: topQuietDeal.title,
          highlight: person || topQuietDeal.title,
          stageName,
          quietDays,
          draftNote: `Hi ${firstName}, just checking in on ${topQuietDeal.title}. Happy to answer any questions or arrange a time to talk it through — let me know what works for you.`,
          quietDeals: quietDeals.map((deal) => ({
            _id: deal._id,
            title: deal.title,
            value: Number(deal.value || 0),
            contactName: contactName(deal.contactId),
            lastActivityAt: deal.lastActivityAt || deal.updatedAt || deal.createdAt,
          })),
        };
      })()
    : {
        title: "Your pipeline is up to date",
        message: `No open deals have crossed the ${QUIET_DEAL_DAYS}-day inactivity threshold.`,
        dealId: null,
        contactId: null,
        draftNote: "",
        quietDeals: [],
      };

  const todayQueue = todayQueueRows.map((task) => ({
    _id: task._id,
    title: task.title,
    dueAt: task.dueAt,
    status: task.status,
    priority: task.priority,
    description: task.description || "",
    source: task.source || "manual",
    contactName: contactName(task.contactId),
    companyName: task.companyId?.name || "",
    dealTitle: task.dealId?.title || "",
    dealValue: Number(task.dealId?.value || 0),
    dealProductType: task.dealId?.productType || "",
    overdueDays: task.dueAt && new Date(task.dueAt) < ranges.startOfToday
      ? Math.max(1, Math.floor((ranges.startOfToday.getTime() - new Date(task.dueAt).getTime()) / DAY_MS))
      : 0,
  }));
  const bookingQueue = upcomingBookings.map((booking) => ({
    _id: booking._id,
    title: booking.title || booking.resourceName || booking.bookingType || "Booking",
    startAt: booking.startAt,
    status: booking.status,
    contactName: contactName(booking.contactId),
  }));

  const occupancy = {
    percent: overallOccupancyPercent,
    desks: { occupied: occupiedDesks, capacity: deskCapacity, percent: deskPercent },
    offices: { occupied: occupiedOffices, capacity: officeCapacity, percent: officePercent },
    configured: hasAnyCapacity,
  };

  res.json({
    success: true,
    message: "Dashboard data fetched successfully.",
    data: {
      asOf: ranges.now,
      timezone,
      currency: workspace?.currency || "HKD",
      greetingName: req.user.name?.split(/\s+/)[0] || "there",
      overview: {
        openPipeline: {
          value: openPipelineValue,
          count: openDealCount,
          previousValue: previousPipelineValue,
          changePercent: pipelineChangePercent,
        },
        occupancy,
        renewals: { count: renewalMemberships.length, recurringValue: renewals },
        needsAction: {
          total: needsActionTotal,
          overdueTasks,
          unpaidInvoices: unpaidInvoiceCount,
          quietDeals: quietDealCount,
        },
        activeMemberships: activeMemberships.length,
        upcomingBookingCount: bookingQueue.length,
      },
      pipelines: pipelineCards,
      todayQueue,
      inbox,
      inboxSummary: {
        total: openConversationCount,
        email: emailConversationCount,
        whatsapp: whatsappConversationCount,
        unreadMessages: unreadConversationAggregate[0]?.count || 0,
      },
      insight,
      revenueMix,
      revenueMixMonth: previousMonthLabel,
      revenueMixTotal: [...revenueByCategory.values()].reduce((sum, amount) => sum + amount, 0),
      leadSources,
      occupancyDetails: {
        activeMemberships: activeMemberships.length,
        bookingsNext60Days: bookingQueue,
      },
      renewalList: renewalMemberships.slice(0, 8).map((item) => ({
        _id: item._id,
        renewalAt: item.renewalAt || item.endAt,
        monthlyValue: Number(item.monthlyValue || 0),
      })),
      invoiceActionTotal: awaitingInvoiceAggregate[0]?.total || 0,
    },
  });
});
