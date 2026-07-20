/**************** CONFIG ****************/
// ============================================================
// ⚠️  ห้าม hardcode ค่าจริงในไฟล์นี้
//     ค่าทั้งหมดเก็บอยู่ใน Script Properties
//     ตั้งค่าครั้งแรกด้วยการรัน setupScriptProperties() ด้านล่าง
// ============================================================
const _props = PropertiesService.getScriptProperties();
const SPREADSHEET_ID = _props.getProperty("SPREADSHEET_ID") || "";
const FOLDER_ID = _props.getProperty("FOLDER_ID") || "";
const TOKEN = _props.getProperty("TOKEN") || "";
const TOKEN2 = _props.getProperty("TOKEN2") || ""; // LINE OA ตัวที่ 2 — ใช้เฉพาะให้แอดมินกดอนุมัติ/ปฏิเสธสำรอง (ไม่ส่งอะไรหา user ทั่วไป)
const BOT_USER_ID_2 = _props.getProperty("BOT_USER_ID_2") || ""; // Bot User ID ของ LINE OA ตัวที่ 2 (ดูได้ที่ LINE Developers Console > Basic settings > Bot Info)
const MANUAL_URL = _props.getProperty("MANUAL_URL") || "";

// ค่า token ของ "ไลน์ที่กำลังคุยด้วยอยู่ตอนนี้" — ถูกตั้งค่าอัตโนมัติต้นทาง doPost()
// ทุกฟังก์ชันที่ตอบกลับ (reply/push ระหว่าง webhook) จะใช้ตัวนี้แทน TOKEN ตรงๆ
// เพื่อให้ตอบถูกไลน์เสมอ ไม่ว่าจะทักมาจาก LINE ตัวหลักหรือตัวสำรอง
let CURRENT_TOKEN = TOKEN;

// Lazy-loaded active spreadsheet cache for high performance (avoids repeated API calls)
let _cachedSS = null;
function getActiveSpreadsheetInstance() {
  if (!_cachedSS) {
    _cachedSS = SPREADSHEET_ID
      ? SpreadsheetApp.openById(SPREADSHEET_ID)
      : SpreadsheetApp.getActiveSpreadsheet();
  }
  return _cachedSS;
}

// ============================================================
//  รันฟังก์ชันนี้ครั้งเดียวเพื่อบันทึกค่าลง Script Properties
//  1. ใส่ค่าจริงด้านล่าง
//  2. กด ▶ Run เลือก setupScriptProperties
//  3. ลบค่าจริงออกจากฟังก์ชันนี้ทันที (เหลือแค่ placeholder)
// ============================================================
function setupScriptProperties() {
  PropertiesService.getScriptProperties().setProperties({
    SPREADSHEET_ID: "ใส่_SPREADSHEET_ID",
    FOLDER_ID: "ใส่_FOLDER_ID",
    TOKEN: "ใส่_CHANNEL_ACCESS_TOKEN",
    TOKEN2: "ใส่_CHANNEL_ACCESS_TOKEN_ไลน์ที่2_หรือเว้นว่างถ้ายังไม่มี",
    MANUAL_URL: "ใส่_URL_คู่มือ_หรือเว้นว่าง",
  });
  Logger.log("✅ บันทึก Script Properties เรียบร้อย");
  Logger.log(
    "SPREADSHEET_ID = " +
      PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID"),
  );
}

// [Design System] ธีมสี (ค่าเริ่มต้น)
const THEME_COLOR = "#2C3E50";
const BTN_PRIMARY = "#2C3E50";
const BTN_SECONDARY = "#95A5A6";
const COLOR_SUCCESS = "#27AE60";
const COLOR_DANGER = "#C0392B";
const COLOR_WARNING = "#F39C12";
const COLOR_ADJUST = "#8E44AD";
const THAI_TIMEZONE = "Asia/Bangkok";

// ============================================================
// 🖼️ Multi-image helpers — คอลัมน์ imageUrl เก็บเป็น JSON array string
//    รองรับสูงสุด 3 รูปต่อรายการ แต่ยัง backward-compat กับ URL เดี่ยวแบบเก่า
// ============================================================
const MAX_ITEM_IMAGES = 3;

function _parseImageList(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  if (s.charAt(0) === "[") {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.filter((x) => x && String(x).trim());
    } catch (e) {
      // ไม่ใช่ JSON ที่ถูกต้อง ตกไปใช้เป็น URL เดี่ยวด้านล่าง
    }
  }
  if (s.includes(",")) {
    return s.split(",").map((x) => x.trim()).filter((x) => x && x !== "-");
  }
  return [s];
}

function _stringifyImageList(arr) {
  const clean = (arr || []).filter((x) => x && String(x).trim()).slice(0, MAX_ITEM_IMAGES);
  return JSON.stringify(clean);
}

function getThaiNow() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 7 * 60 * 60 * 1000);
}

function formatThaiDateTime(value) {
  const d = value ? new Date(value) : getThaiNow();
  return Utilities.formatDate(d, THAI_TIMEZONE, "dd/MM/yyyy HH:mm:ss");
}

// Unified popup styles + helpers for all dialogs in the app
(function () {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  const styleId = "unified-popup-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .app-popup-overlay {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        padding: 16px;
      }
      .app-popup {
        width: min(92vw, 420px);
        background: #ffffff;
        border-radius: 16px;
        box-shadow: 0 18px 45px rgba(0,0,0,.2);
        overflow: hidden;
        font-family: "Segoe UI", Tahoma, sans-serif;
        border-top: 6px solid #2C3E50;
      }
      .app-popup.success { border-top-color: #27AE60; }
      .app-popup.error { border-top-color: #C0392B; }
      .app-popup.warning { border-top-color: #F39C12; }
      .app-popup-header { padding: 18px 20px 8px; }
      .app-popup-title { margin: 0; font-size: 18px; font-weight: 700; color: #1f2937; }
      .app-popup-body { padding: 0 20px 16px; color: #4b5563; line-height: 1.6; white-space: pre-line; }
      .app-popup-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 20px 20px; }
      .app-popup-btn { border: none; border-radius: 999px; padding: 9px 16px; font-weight: 600; cursor: pointer; }
      .app-popup-btn.primary { background: #2C3E50; color: #fff; }
      .app-popup-btn.secondary { background: #e5e7eb; color: #374151; }
      .app-popup-icon { display: inline-block; margin-right: 6px; }
    `;
    document.head.appendChild(style);
  }

  function createUnifiedPopup(options) {
    const {
      title = "แจ้งเตือน",
      message = "",
      type = "info",
      confirmText = "ตกลง",
      cancelText = "ยกเลิก",
      showCancel = false,
      onConfirm = null,
      onCancel = null,
    } = options || {};

    const overlay = document.createElement("div");
    overlay.className = "app-popup-overlay";
    const popup = document.createElement("div");
    popup.className = `app-popup ${type}`;
    const iconMap = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };
    popup.innerHTML = `
      <div class="app-popup-header">
        <h3 class="app-popup-title"><span class="app-popup-icon">${iconMap[type] || "ℹ️"}</span>${title}</h3>
      </div>
      <div class="app-popup-body">${String(message || "").replace(/\n/g, "<br>")}</div>
      <div class="app-popup-footer">
        ${showCancel ? `<button class="app-popup-btn secondary" data-action="cancel">${cancelText}</button>` : ""}
        <button class="app-popup-btn primary" data-action="confirm">${confirmText}</button>
      </div>`;
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
    }
    popup
      .querySelector('[data-action="confirm"]')
      .addEventListener("click", () => {
        close();
        if (typeof onConfirm === "function") onConfirm();
      });
    if (showCancel) {
      popup
        .querySelector('[data-action="cancel"]')
        .addEventListener("click", () => {
          close();
          if (typeof onCancel === "function") onCancel();
        });
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        close();
        if (typeof onCancel === "function") onCancel();
      }
    });
    return popup;
  }

  window.showUnifiedPopup = createUnifiedPopup;
  window.showSuccessPopup = (message, title = "สำเร็จ") =>
    createUnifiedPopup({
      title,
      message,
      type: "success",
      confirmText: "รับทราบ",
    });
  window.showErrorPopup = (message, title = "เกิดข้อผิดพลาด") =>
    createUnifiedPopup({
      title,
      message,
      type: "error",
      confirmText: "รับทราบ",
    });
  window.showWarningPopup = (message, title = "คำเตือน") =>
    createUnifiedPopup({
      title,
      message,
      type: "warning",
      confirmText: "รับทราบ",
    });
})();

// [ฟังก์ชันตั้งค่าเริ่มต้นกรณีหน้าเว็บยังไม่เคยเซฟ]
function getDefaultSettings() {
  return {
    sysName: "คลังอะไหล่เมาท์เทน",
    themeColor: "#2C3E50",
    prefixItem: "IT",
    prefixTool: "TL",
    maintenance: false,
    welcomeMsg:
      "👋 ยินดีต้อนรับสู่ระบบคลังอะไหล่เมาท์เทน\n\n👇 ด้านล่างนี้คือคู่มือการใช้งานเบื้องต้นครับ\n\nกรุณาสแกน QR Code ที่หน้างานเพื่อลงทะเบียนใช้งาน แล้วรอแอดมินอนุมัติ จากนั้นจะเข้าใช้งานได้เลยครับ",
    manualUrl: "",
    autoApprove: false,
    maxBorrowDays: 7,
    reqRemark: false,
    decimalPlaces: 0,
    lineNotifyToken: "",
    dailyDigestTime: "08:30",
    sessionTimeout: 30,
    adminContact: "",
    rowsPerPage: 100,
    dateFormat: "TH",
    darkMode: false,
    sysLogo: "",
    lineOaId: "", // LINE OA ID สำหรับ QR Fast Track เช่น @abc1234d
    activeLineChannel: "1", // "1" หรือ "2" — ไลน์หลักที่ใช้ส่ง Broadcast/แจ้งเตือนทั่วไปตอนนี้ (สลับได้ในหน้า Settings เวลาไลน์หลักโดนริมิต)
    workingHourEnabled: false,
    workingHourStart: "08:00",
    workingHourEnd: "17:00",
    holidayDates: "",
    lowStockAlertEnabled: true,
    lowStockPercent: 100,
    autoBackupEnabled: false,
    autoBackupTime: "23:00",
    autoBackupEmail: "",
    permExportUser: false,
    permExportStaff: true,
    permPriceUser: false,
    permPriceStaff: true,
    permEditHistoryUser: false,
    permEditHistoryStaff: false,
  };
}

let _cachedSettings = null;
function getSettings() {
  if (!_cachedSettings) {
    const props = PropertiesService.getScriptProperties();
    const s = props.getProperty("APP_SETTINGS");
    _cachedSettings = s ? JSON.parse(s) : getDefaultSettings();
  }
  return _cachedSettings;
}

// เปิด/ปิดข้อความแจ้งเตือน "โควต้าบอทหลักเต็ม ถูกสลับมาบอทสำรอง"
// อ่านค่าจาก Settings (ตั้งได้จากหน้าเว็บ Dashboard > ตั้งค่า) — ค่าเริ่มต้น = ปิด เพื่อประหยัดโทเค็น
function isNotifyFallbackEnabled() {
  const settings = getSettings();
  return !!settings.notifyFallbackSwitch;
}

// ข้อความแจ้งเตือนตอนสลับไปบอทสำรอง — แก้ไขได้จากหน้าเว็บ Dashboard > ตั้งค่า ถ้าไม่ได้ตั้งจะใช้ข้อความเริ่มต้น
function getNotifyFallbackMsg() {
  const settings = getSettings();
  const msg = String(settings.notifyFallbackMsg || "").trim();
  return msg || "🚨 แจ้งเตือนจากระบบ:\nโควต้าบอทตัวหลักเต็มแล้ว! ข้อความนี้จึงถูกสลับมาส่งผ่านบอทสำรองครับ";
}

// คืน token ของ "ไลน์หลักที่ใช้งานอยู่ตอนนี้" ตามที่ตั้งค่าไว้ในหน้า Settings
// ใช้กับ Broadcast / แจ้งเตือนทั่วไปที่ยิงหา user (ไม่ใช่การอนุมัติของแอดมิน ซึ่งมีของตัวเองอยู่แล้ว)
function getPrimaryToken() {
  const settings = getSettings();
  if (settings.activeLineChannel === "2" && TOKEN2) return TOKEN2;
  return TOKEN;
}

// ตรวจสอบว่าตอนนี้อยู่ในเวลาทำการหรือไม่ (ตั้งค่าได้จากหน้าเว็บ Dashboard > ตั้งค่า > เงื่อนไขระบบ)
// คืนค่า {ok:true} ถ้าอนุญาตให้ทำรายการ, {ok:false, error:'...'} ถ้าอยู่นอกเวลา/วันหยุด
function _checkWorkingHours() {
  const settings = getSettings();
  if (!settings.workingHourEnabled) return { ok: true };

  const tzOffset = 7 * 60 * 60 * 1000;
  const now = new Date(new Date().getTime() + tzOffset);
  const todayStr = Utilities.formatDate(now, "GMT", "yyyy-MM-dd");

  const holidays = String(settings.holidayDates || "")
    .split(",")
    .map((d) => d.trim())
    .filter((d) => d);
  if (holidays.includes(todayStr)) {
    return { ok: false, error: "วันนี้เป็นวันหยุดบริษัท ไม่สามารถทำรายการได้" };
  }

  const start = String(settings.workingHourStart || "08:00");
  const end = String(settings.workingHourEnd || "17:00");
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

  if (nowMinutes < startMinutes || nowMinutes > endMinutes) {
    return {
      ok: false,
      error: `นอกเวลาทำการ (เปิดทำการ ${start}-${end} น.) กรุณาทำรายการในเวลาทำการ`,
    };
  }
  return { ok: true };
}

// คืนค่า % ที่ตั้งไว้สำหรับแจ้งเตือนสต็อกใกล้หมด (default 100 = เตือนพอดีค่าขั้นต่ำ)
function getLowStockPercent() {
  const settings = getSettings();
  if (!settings.lowStockAlertEnabled) return null; // ปิดใช้งานแจ้งเตือน
  return Number(settings.lowStockPercent) || 100;
}

/**************** ENTRY POINT (LINE BOT) ****************/
function _jsonResp(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return _jsonResp({ success: false, error: "no data" });
    }
    const data = JSON.parse(e.postData.contents);

    // ── Web API route (qr.html / dashboard ส่งมาแบบ { fn, args }) ──
    if (data.fn) {
      const fn = data.fn;
      const args = data.args || [];
      const allowed = [
        "webBatchTransaction",
        "webAddNewItems",
        "webVerifyUserPin",
        "webChangeUserPin",
        "webSaveItemImage",
        "webDeleteItemImage",
        "getInventoryData",
        "webGetStockLevels",
        "getLoginUsers",
        "webRegisterUser",
        "webApproveQRUser",
        "webRejectQRUser",
        "webCheckRegStatus",
        "webGetNotes",
        "webSaveNote",
        "webDeleteNote",
        "webUpdateUser",
        "webUpdateUserPin",
        "webEditItem",
        "webAdjustStock",
        "webGetSettings",
        "webSaveSettings",
        "webGetPendingPO",
        "webApprovePO",
        "webCreatePO",
        "webGetBorrowRequests",
        "webApproveBorrow",
        "webRejectBorrow",
        "webApproveRequest",
        "webRejectRequest",
        "approveBorrowRequest",
        "rejectBorrowRequest",
        "webReturnBorrow",
        "webGetDamageReports",
        "webRepairItem",
        "getUserHistory",
        "webReturnItem",
        "webGetNextCode",
        "webSaveProfileImage",
        "webGetStockTakeProgress",
        "webSubmitStockCount",
        "webCloseStockTake",
        "webGetStockTakeReport",
        "webGetStockTakeDiffs",
        "webResolveStockDiff",
        "webGetItemRecentWithdraws",
        "webGetMyRetroWithdraws",
        "webAssignStockDiffUser",
        "webGetMyPendingRetroWithdraws",
        "webSubmitRetroWithdrawByUser",
        "webBroadcastMessage",
        "webGetPendingWebRequests",
        "webGetMyPendingRequests",
        "webGetPendingRequests",
        "webGetPendingApprovals",
        "webApprovePendingRequest",
        "webApproveMultiplePendingRequests",
        "webRejectMultiplePendingRequests",
        "webRejectPendingRequest",
        "webCancelMyPendingRequest",
        "webGetMyRecentDecisions",
        "webApprovePendingApproval",
        "webRejectPendingApproval",
        "approveWebPendingRequest",
        "rejectWebPendingRequest",
        "getPendingWebRequests",
        "getPendingRequests",
        "getPendingApprovals",
        "webFixLegacyQrRoles",
        "webSavePrintLog",
        "webGetPrintLogs",
        "webClearAllPendingRequests",
        "webGetReceiptData",
        "webReportFailedLoginAttempt",
      ];
      if (!allowed.includes(fn)) {
        return _jsonResp({ success: false, error: "fn not allowed: " + fn });
      }
      try {
        const result = this[fn](...args);
        return _jsonResp(result !== undefined ? result : { success: true });
      } catch (err) {
        return _jsonResp({ success: false, error: err.toString() });
      }
    }

    // ── LINE Webhook route ──
const event = data.events ? data.events[0] : null;
if (!event) {
  return _jsonResp({ success: false, error: "no event" });
}
const userId = event.source.userId;
 const replyToken = event.replyToken;

 // สลับ CURRENT_TOKEN ให้ตรงกับบอทที่รับ event นี้เข้ามา (หลัก/สำรอง)
 // ถ้าไม่ทำจุดนี้ ข้อความที่เข้ามาทางบอทสำรองจะตอบกลับไม่ได้เลย เพราะ token ไม่ตรงกับ replyToken
 CURRENT_TOKEN = (data.destination === BOT_USER_ID_2 && TOKEN2) ? TOKEN2 : TOKEN;

 if (event && event.replyToken && event.type === "message" && event.message && event.message.text === "เช็คไลน์999") {
  UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
    method: "post",
    headers: { "Authorization": "Bearer " + (data.destination === BOT_USER_ID_2 ? TOKEN2 : TOKEN), "Content-Type": "application/json" },
    payload: JSON.stringify({ replyToken: event.replyToken, messages: [{ type: "text", text: "DESTINATION=" + data.destination }] }),
    muteHttpExceptions: true
  });
  return;
}

 // เช็ค User ID ส่วนตัวของคนที่พิมพ์ — เอาไปใส่ในคอลัมน์ lineId2 ของชีต Users ให้ถูกคน
 if (event && event.replyToken && event.type === "message" && event.message && event.message.text === "เช็คไอดีฉัน") {
  UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
    method: "post",
    headers: { "Authorization": "Bearer " + (data.destination === BOT_USER_ID_2 ? TOKEN2 : TOKEN), "Content-Type": "application/json" },
    payload: JSON.stringify({ replyToken: event.replyToken, messages: [{ type: "text", text: "USERID=" + userId }] }),
    muteHttpExceptions: true
  });
  return;
}
    CacheService.getScriptCache().put(replyToken, "processed", 60);

    const settings = getSettings();

    // --- แสดงการ์ดต้อนรับ พร้อมปุ่มเข้าเว็บทำรายการเบิก เมื่อมีคนแอดไลน์ใหม่ ---
    if (event.type === "follow") {
      replyFlex(replyToken, flexWelcomeEntry(settings));
      return;
    }

    const user = getUser(userId);
    // ตรวจสอบโหมด Maintenance
    if (settings.maintenance && user && user.role !== "admin") {
      return reply(
        replyToken,
        "🚧 ระบบกำลังปิดปรับปรุง/นับสต็อกชั่วคราว กรุณาติดต่อ Admin ครับ",
      );
    }

    if (event.type === "postback") {
      return handlePostback(event.postback.data, userId, replyToken);
    }

    if (event.type === "message") {
      // 1. จัดการรูปภาพ
      if (event.message.type === "image") {
        const step = cacheGet(userId, "newItemStep");
        if (step === "5") {
          return handleNewItemProcess(
            userId,
            replyToken,
            null,
            event.message.id,
          );
        }
        saveImage(event.message.id, userId);
        const pendingItem = cacheGet(userId, "item");
        const pendingQty = cacheGet(userId, "qty");
        const pendingMode = cacheGet(userId, "mode");
        const returnReqId = cacheGet(userId, "return_req_id");

        if (returnReqId) {
          const borrowData = getBorrowRequestById(returnReqId);
          if (borrowData) {
            return replyFlex(
              replyToken,
              flexConfirm(
                {
                  mode: "คืน",
                  machine: borrowData.category,
                  itemName: borrowData.itemName,
                  itemCode: borrowData.itemCode,
                  qty: borrowData.qty,
                },
                settings,
              ),
            );
          }
        } else if (pendingItem && pendingQty) {
          const itemInfo = getItemInfo(
            pendingItem,
            getPreferredSheet(pendingMode),
          );
          return replyFlex(
            replyToken,
            flexConfirm(
              {
                mode: pendingMode,
                machine: itemInfo.category,
                itemName: itemInfo.name,
                itemCode: itemInfo.code,
                qty: Number(pendingQty),
              },
              settings,
            ),
          );
        }
        return reply(replyToken, "📸 บันทึกรูปภาพเรียบร้อย!");
      }
      // 2. จัดการข้อความ Text
      if (event.message.type === "text") {
        return handleText(event.message.text.trim(), userId, replyToken);
      }

      return reply(
        replyToken,
        "⚠️ ขออภัยครับ ระบบรองรับเฉพาะการพิมพ์ข้อความและส่งรูปภาพเท่านั้น\n\n(หากต้องการเริ่มใหม่ พิมพ์ 'เมนู')",
      );
    }
  } catch (error) {
    console.error("Main Error: " + error.toString());
    try {
      const data = JSON.parse(e.postData.contents);
      const token = data.events[0].replyToken;
      // ป้องกันการส่งข้อความ error ซ้ำๆ
      if (!CacheService.getScriptCache().get(token + "_err")) {
        reply(
          token,
          "❌ เกิดข้อผิดพลาดทางเทคนิค กรุณาลองใหม่อีกครั้ง หรือติดต่อผู้ดูแลระบบ",
        );
        CacheService.getScriptCache().put(token + "_err", "1", 60);
      }
    } catch (err) {
      // Ignore inner catch
    }
  }
}
// 1. ฟังก์ชันสำหรับตรวจสอบรหัสผ่านรายบุคคล
function webVerifyUserPin(uid, pin) {
  try {
    const ss = getActiveSpreadsheetInstance();
    const sh = ss.getSheetByName("Users");
    if (!sh) return false;

    const data = sh.getDataRange().getValues();
    const headers = data[0];

    // หา column PIN จาก header ก่อน
    // layout: A=userId B=name C=role D=PIN E=dept F=Time
    let pinColIdx = headers.findIndex(
      (h) => String(h).trim().toUpperCase() === "PIN",
    );
    if (pinColIdx === -1) pinColIdx = 3; // fallback col D (index 3)

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(uid).trim()) {
        let userPin = String(data[i][pinColIdx] || "").trim();
        // ถ้า PIN ว่าง ให้ default เป็น '1234'
        if (userPin === "") userPin = "1234";
        return userPin === String(pin).trim();
      }
    }
    return false;
  } catch (e) {
    console.error(e);
    return false;
  }
}

// 2. ฟังก์ชันสำหรับเปลี่ยนรหัสผ่านส่วนตัว
function webUpdateUserPin(uid, newPin) {
  try {
    const ss = getActiveSpreadsheetInstance();
    const sheet = ss.getSheetByName("Users");
    if (!sheet) return { success: false, error: "ไม่พบชีต Users" };
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    let pinColIdx = headers.indexOf("PIN");
    // ถ้ายังไม่มีคอลัมน์ PIN ให้สร้างใหม่
    if (pinColIdx === -1) {
      pinColIdx = headers.length;
      sheet.getRange(1, pinColIdx + 1).setValue("PIN");
    }
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(uid)) {
        sheet.getRange(i + 1, pinColIdx + 1).setValue(String(newPin).trim());
        return { success: true };
      }
    }
    return { success: false, error: "ไม่พบผู้ใช้งานนี้ในระบบ" };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// 2b. เปลี่ยน PIN ด้วยตัวเอง — ต้องยืนยัน PIN เก่าให้ถูกต้องก่อนเสมอ
//     (ก่อนหน้านี้ฟังก์ชันนี้ถูกเรียกจากหน้าเว็บ qr.gs แต่ไม่มีตัวจริงอยู่ใน backend)
function webChangeUserPin(uid, oldPin, newPin) {
  try {
    if (!uid || !newPin) {
      return { success: false, error: "ข้อมูลไม่ครบถ้วน" };
    }
    if (String(newPin).trim().length < 4) {
      return { success: false, error: "PIN ใหม่ต้องมีอย่างน้อย 4 หลัก" };
    }
    // ต้องตรวจ PIN เก่าให้ถูกต้องก่อนเสมอ ห้ามข้ามขั้นตอนนี้
    if (!webVerifyUserPin(uid, oldPin)) {
      return { success: false, error: "PIN เก่าไม่ถูกต้อง" };
    }

    const result = webUpdateUserPin(uid, newPin);
    if (result.success) {
      const user = getUser(uid);
      _writeAudit(
        "CHANGE_PIN",
        "เปลี่ยน PIN ส่วนตัว",
        user ? user.name : "-",
        uid,
        user ? user.role : "-",
        "Web",
      );
    }
    return result;
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// 3b. ดึงรายชื่อ users เฉพาะสำหรับหน้า Login (เร็วกว่า getInventoryData มาก)
function getLoginUsers() {
  try {
    const ss = getActiveSpreadsheetInstance();
    const sh = ss.getSheetByName("Users");
    if (!sh || sh.getLastRow() < 2) return [];
    const data = sh.getDataRange().getValues();
    const headers = data[0];
    const photoColIdx = headers.findIndex(
      (h) => String(h).toLowerCase().trim() === "photourl",
    );
    return data
      .slice(1)
      .filter((r) => {
        const role = String(r[2] || "")
          .trim()
          .toLowerCase();
        return (
          (role === "admin" ||
            role === "user" ||
            role === "staff" ||
            role === "qr") &&
          String(r[0] || "").trim() !== ""
        );
      })
      .map((r) => ({
        userId: String(r[0] || "").trim(),
        name: String(r[1] || "").trim(),
        role: String(r[2] || "").trim(),
        photoUrl: photoColIdx >= 0 ? String(r[photoColIdx] || "").trim() : "",
      }));
  } catch (e) {
    return [];
  }
}
// ลงทะเบียนผู้ใช้ใหม่ (จากหน้าทำรายการ QR)
// ⚠️ เขียนลง sheet "QRRegistrations" แยกต่างหาก — ไม่แตะ Users sheet เลย
// เมื่อ Admin อนุมัติผ่าน LINE ค่อยย้ายมา Users พร้อม PIN ที่ถูกต้อง
function webRegisterUser(payload) {
  try {
    if (!payload || !payload.name || !payload.pin || payload.pin.length < 4) {
      return { success: false, error: "ข้อมูลไม่ครบถ้วน" };
    }

    // ตั้งค่าเวลาเป็นไทย (GMT+7)
    const now = new Date();
    const tzOffset = 7 * 60 * 60 * 1000;
    const localTime = new Date(now.getTime() + tzOffset);

    // สร้าง ID ชั่วคราวสำหรับ QR registration
    const newUserId =
      "U" + Date.now() + Math.random().toString(36).substring(2, 9);

    // ---- เขียนลง QRRegistrations sheet (แยกจาก Users) ----
    const ss = getActiveSpreadsheetInstance();
    let qrSh = ss.getSheetByName("QRRegistrations");
    if (!qrSh) {
      // สร้าง sheet ใหม่ถ้ายังไม่มี
      qrSh = ss.insertSheet("QRRegistrations");
      qrSh.appendRow([
        "userId",
        "name",
        "dept",
        "PIN",
        "registeredAt",
        "status",
      ]);
      qrSh.setFrozenRows(1);
    }

    // ตรวจชื่อซ้ำใน QRRegistrations (กันกดสมัครซ้ำ)
    const qrRows = qrSh.getDataRange().getValues().slice(1);
    const dupQR = qrRows.find(
      (r) =>
        String(r[1] || "").trim() === payload.name.trim() &&
        String(r[5] || "").trim() === "pending",
    );
    if (dupQR)
      return {
        success: false,
        error: `ชื่อ "${payload.name}" ยังรอการอนุมัติอยู่`,
      };

    // ตรวจชื่อซ้ำใน Users (กันสมัครทับคนที่อนุมัติแล้ว)
    const usersRows = sheet("Users").getDataRange().getValues().slice(1);
    const dupUser = usersRows.find(
      (r) => String(r[1] || "").trim() === payload.name.trim(),
    );
    if (dupUser)
      return { success: false, error: `ชื่อ "${payload.name}" มีในระบบแล้ว` };

    // บันทึกลง QRRegistrations: [userId, name, dept, PIN, registeredAt, status]
    qrSh.appendRow([
      newUserId,
      payload.name,
      payload.dept || "",
      payload.pin, // PIN เก็บแค่ใน QRRegistrations ไม่ไปยุ่งกับ Users
      localTime,
      "pending",
    ]);

    // บันทึก audit
    _writeAudit(
      "REGISTER",
      `สมัครใหม่: ${payload.name} (${payload.dept || "ไม่ระบุ"})`,
      payload.name,
      newUserId,
      "pending",
      "Web-Registration",
    );

    // แจ้งเตือนแอดมินทาง LINE พร้อมปุ่มอนุมัติ (postback "approve:" ตัวเดิม รองรับ QRRegistrations อยู่แล้ว)
    try {
      notifyAdmins(newUserId, payload.name);
    } catch (e) {
      // ไม่ให้การแจ้งเตือนล้มเหลวกระทบผลการสมัคร
    }

    return {
      success: true,
      message: `ส่งคำขอสมัครของ "${payload.name}" เรียบร้อย!`,
      userId: newUserId,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ตรวจสถานะคำขอสมัคร (ใช้ poll จากหน้า qr.html ตอนรอ Admin อนุมัติ)
function webCheckRegStatus(userId) {
  try {
    const ss = getActiveSpreadsheetInstance();
    const qrSh = ss.getSheetByName("QRRegistrations");
    if (!qrSh) return { success: false, error: "ไม่พบ QRRegistrations sheet" };
    const rows = qrSh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === String(userId).trim()) {
        return { success: true, status: String(rows[i][5]).trim() };
      }
    }
    return { success: false, error: "ไม่พบคำขอนี้" };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ── QR Registration Functions ──────────────────────────────

function webGetQRPending() {
  try {
    const ss = getActiveSpreadsheetInstance();
    const sh = ss.getSheetByName("QRRegistrations");
    if (!sh) return [];
    const rows = sh.getDataRange().getValues().slice(1);
    return rows
      .filter((r) => String(r[5]).trim() === "pending")
      .map((r) => ({
        userId: String(r[0]),
        name: String(r[1]),
        dept: String(r[2]),
        pin: String(r[3]),
        registeredAt: r[4]
          ? Utilities.formatDate(
              new Date(r[4]),
              "Asia/Bangkok",
              "dd/MM/yyyy HH:mm",
            )
          : "",
        status: String(r[5]),
      }));
  } catch (e) {
    return [];
  }
}

function webApproveQRUser(userId, actorUserId) {
  const auth = _requireRole(actorUserId, ["admin"]);
  if (!auth.ok) return auth;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000))
    return {
      success: false,
      error: "ระบบกำลังประมวลผลคำขออื่นอยู่ ลองใหม่อีกครั้ง",
    };
  try {
    const ss = getActiveSpreadsheetInstance();
    const qrSh = ss.getSheetByName("QRRegistrations");
    if (!qrSh) return { success: false, error: "ไม่พบ QRRegistrations sheet" };

    const qrData = qrSh.getDataRange().getValues();
    for (let i = 1; i < qrData.length; i++) {
      if (
        String(qrData[i][0]).trim() === String(userId).trim() &&
        String(qrData[i][5]).trim() === "pending"
      ) {
        const name = qrData[i][1];
        const dept = qrData[i][2];
        const pin = qrData[i][3];
        const date = qrData[i][4];

        // ย้ายเข้า Users sheet (ใช้ sheet() helper เหมือนฝั่ง LINE เพื่อการันตีว่ามีชีตแน่นอน)
        const usersSh = sheet("Users");
        const numCols = Math.max(usersSh.getLastColumn(), 8);
        const row = new Array(numCols).fill("");
        row[0] = userId;
        row[1] = name;
        row[2] = "qr"; // QR user เข้าได้แค่หน้า qr.html
        row[3] = pin; // col D = PIN
        row[4] = dept; // col E = dept
        row[5] = date; // col F = Time
        row[7] = "QR-Registration";
        usersSh.appendRow(row);

        // อัปเดต status ใน QRRegistrations
        qrSh.getRange(i + 1, 6).setValue("approved");

        // บังคับ commit การเขียนทันที กันกรณี client อ่านข้อมูลซ้ำก่อนที่ Sheet จะอัปเดตจริง
        SpreadsheetApp.flush();

        // ตรวจสอบซ้ำว่าแถวถูกบันทึกจริงก่อนแจ้งว่าสำเร็จ
        const verifyData = usersSh.getDataRange().getValues();
        const saved = verifyData.some(
          (r) => String(r[0]).trim() === String(userId).trim(),
        );
        if (!saved) {
          return {
            success: false,
            error: "บันทึกลง Users sheet ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
          };
        }

        _writeAudit(
          "REGISTER",
          "อนุมัติจาก QR: " + name,
          "Admin",
          userId,
          "user",
          "Web-Approve",
        );

        // แจ้งเตือนผู้สมัครทาง LINE เหมือนตอนอนุมัติผ่านไลน์
        try {
          push(userId, [
            { type: "text", text: "✅ บัญชีอนุมัติแล้ว! พิมพ์ 'เมนู' ได้เลย" },
          ]);
        } catch (pushErr) {
          // ไม่ต้อง fail ทั้งคำขอ ถ้าส่ง LINE แจ้งเตือนไม่สำเร็จ
        }

        return { success: true };
      }
    }
    return { success: false, error: "ไม่พบคำขอนี้" };
  } catch (e) {
    return { success: false, error: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function webRejectQRUser(userId, actorUserId) {
  const auth = _requireRole(actorUserId, ["admin"]);
  if (!auth.ok) return auth;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000))
    return {
      success: false,
      error: "ระบบกำลังประมวลผลคำขออื่นอยู่ ลองใหม่อีกครั้ง",
    };
  try {
    const ss = getActiveSpreadsheetInstance();
    const qrSh = ss.getSheetByName("QRRegistrations");
    if (!qrSh) return { success: false, error: "ไม่พบ QRRegistrations sheet" };

    const qrData = qrSh.getDataRange().getValues();
    for (let i = 1; i < qrData.length; i++) {
      if (
        String(qrData[i][0]).trim() === String(userId).trim() &&
        String(qrData[i][5]).trim() === "pending"
      ) {
        qrSh.getRange(i + 1, 6).setValue("rejected");
        SpreadsheetApp.flush();

        // แจ้งเตือนผู้สมัครทาง LINE เหมือนตอนปฏิเสธผ่านไลน์ (เดิมขาดตรงนี้ไป)
        try {
          push(userId, [{ type: "text", text: "❌ คำขอถูกปฏิเสธ" }]);
        } catch (pushErr) {
          // ไม่ต้อง fail ทั้งคำขอ ถ้าส่ง LINE แจ้งเตือนไม่สำเร็จ
        }

        _writeAudit(
          "REGISTER",
          "ปฏิเสธจาก QR: " + qrData[i][1],
          "Admin",
          userId,
          "rejected",
          "Web-Reject",
        );
        return { success: true };
      }
    }
    return { success: false, error: "ไม่พบคำขอนี้" };
  } catch (e) {
    return { success: false, error: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  const settings = getSettings();
  // ตรวจสอบพารามิเตอร์ url ว่ามีการเรียกหน้า scanner หรือไม่
  if (e.parameter.page === "scanner") {
    return HtmlService.createTemplateFromFile("Scanner")
      .evaluate()
      .setTitle("สแกน QR Code - " + (settings.sysName || "คลังอะไหล่"))
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag(
        "viewport",
        "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
      );
  }

  // เส้นทางสำหรับการทดสอบแดชบอร์ด V3 (คุมโทนสีทอง-ดำ) อย่างปลอดภัย
  if (e.parameter.page === "v3") {
    return HtmlService.createTemplateFromFile("index3")
      .evaluate()
      .setTitle(settings.sysName || "คลังอะไหล่เมาท์เทน - V3")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }

  // ถ้าไม่มีการระบุหน้า ให้โหลดหน้า Dashboard หลัก
  return HtmlService.createTemplateFromFile("C-Factory_Dashboard_Pro")
    .evaluate()
    .setTitle(settings.sysName || "คลังอะไหล่เมาท์เทน")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

// [ฟังก์ชันดึงข้อมูลสำหรับหน้าเว็บ]

/* ============================================================
   NOTES SYSTEM — เก็บใน Google Sheet แทน localStorage
============================================================ */
function webGetNotes(userId) {
  try {
    const sh = sheet("Notes");
    const data = sh.getDataRange().getValues();
    const notes = [];

    // ข้ามแถวแรกถ้าเป็น header
    const startRow = String(data[0][0]).trim() === "noteId" ? 1 : 0;

    for (let i = startRow; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      const rowUserId = String(row[1]).trim();
      // แสดงโน้ตของ user นั้น หรือถ้า userId ว่าง (ข้อมูลเก่า) ก็แสดงด้วย
      if (rowUserId === String(userId) || rowUserId === "") {
        notes.push({
          id: String(row[0]),
          userId: String(row[1]),
          userName: String(row[2]),
          title: String(row[3]),
          body: String(row[4]),
          color: String(row[5]) || "#fbbf24",
          createdAt: row[6] ? new Date(row[6]).getTime() : Date.now(),
          updatedAt: row[7] ? new Date(row[7]).getTime() : Date.now(),
        });
      }
    }
    notes.sort((a, b) => b.createdAt - a.createdAt);
    return { success: true, notes: notes };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webSaveNote(payload) {
  try {
    const sh = sheet("Notes");

    // สร้าง header อัตโนมัติถ้ายังไม่มี
    const NOTES_HEADERS = [
      "noteId",
      "userId",
      "userName",
      "title",
      "body",
      "color",
      "createdAt",
      "updatedAt",
    ];
    if (sh.getLastRow() === 0) {
      sh.appendRow(NOTES_HEADERS);
    } else {
      const firstRow = sh
        .getRange(1, 1, 1, NOTES_HEADERS.length)
        .getValues()[0];
      if (String(firstRow[0]).trim() !== "noteId") {
        sh.insertRowBefore(1);
        sh.getRange(1, 1, 1, NOTES_HEADERS.length).setValues([NOTES_HEADERS]);
      }
    }

    const data = sh.getDataRange().getValues();
    const now = new Date();

    if (payload.id) {
      // แก้ไขโน้ตที่มีอยู่
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(payload.id)) {
          sh.getRange(i + 1, 4).setValue(payload.title || "");
          sh.getRange(i + 1, 5).setValue(payload.body || "");
          sh.getRange(i + 1, 6).setValue(payload.color || "#fbbf24");
          sh.getRange(i + 1, 8).setValue(now);
          return { success: true };
        }
      }
      return { success: false, error: "ไม่พบโน้ตนี้" };
    } else {
      // สร้างโน้ตใหม่
      const noteId = "N" + Date.now();
      sh.appendRow([
        noteId,
        payload.userId || "",
        payload.userName || "",
        payload.title || "",
        payload.body || "",
        payload.color || "#fbbf24",
        now,
        now,
      ]);
      return { success: true, id: noteId };
    }
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webDeleteNote(noteId, userId) {
  try {
    const sh = sheet("Notes");
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (
        String(data[i][0]) === String(noteId) &&
        String(data[i][1]) === String(userId)
      ) {
        sh.deleteRow(i + 1);
        return { success: true };
      }
    }
    return { success: false, error: "ไม่พบโน้ตนี้" };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ดึงเฉพาะรหัส+ยอดสต็อกปัจจุบัน (เบากว่า getInventoryData มาก) ไว้ใช้ poll แบบเรียลไทม์ทุก 2-3 วิ
function webGetStockLevels() {
  try {
    const ss = getActiveSpreadsheetInstance();
    const readStock = (sheetName) => {
      const s = ss.getSheetByName(sheetName);
      if (!s || s.getLastRow() < 2) return [];
      // อ่านแค่คอลัมน์ A (code) ถึง F (stock) พอ ไม่ต้องอ่านทั้งชีต
      const rows = s.getRange(2, 1, s.getLastRow() - 1, 6).getValues();
      return rows.map((r) => ({
        code: String(r[0] || "").trim(),
        stock: Number(r[5] || 0),
      }));
    };
    return {
      success: true,
      items: readStock("Items"),
      tools: readStock("Tools"),
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function getInventoryData() {
  try {
    const ss = getActiveSpreadsheetInstance();
    const getData = (sheetName) => {
      const s = ss.getSheetByName(sheetName);
      if (s && s.getLastRow() > 1) {
        return s.getDataRange().getValues().slice(1);
      }
      return [];
    };

    // ⚠️ ดึงข้อมูลพร้อมบังคับลบช่องว่าง (Trim) เพื่อแก้ปัญหาการกรองหมวดหมู่หน้าเว็บ
    const itemsData = getData("Items");
    // หา index ของ location column จาก header row (รองรับทั้ง sheet ที่มีและไม่มี location column)
    const itemsHeader = (() => {
      const s = ss.getSheetByName("Items");
      return s && s.getLastRow() > 0
        ? s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0]
        : [];
    })();
    const itemsLocCol = itemsHeader.findIndex(
      (h) => String(h).toLowerCase().trim() === "location",
    );

    const itemsImgCol = itemsHeader.findIndex(
      (h) => String(h).toLowerCase().trim() === "imageurl",
    );

    const items = itemsData.map((r) => {
      return {
        code: String(r[0] || "").trim(),
        name: String(r[1] || "").trim(),
        category: String(r[2] || "").trim(),
        unit: String(r[3] || "").trim(),
        min: Number(r[4] || 0),
        stock: Number(r[5] || 0),
        location: itemsLocCol >= 0 ? String(r[itemsLocCol] || "").trim() : "",
        date: String(r[7] || "").trim(),
        remark: String(r[8] || "").trim(),
        imageUrl: (() => {
          const raw = itemsImgCol >= 0 ? String(r[itemsImgCol] || "").trim() : "";
          const list = _parseImageList(raw);
          return list[0] || "";
        })(),
        images: (() => {
          const raw = itemsImgCol >= 0 ? String(r[itemsImgCol] || "").trim() : "";
          return _parseImageList(raw);
        })(),
      };
    });

    const toolsData = getData("Tools");
    const toolsHeader = (() => {
      const s = ss.getSheetByName("Tools");
      return s && s.getLastRow() > 0
        ? s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0]
        : [];
    })();
    const toolsLocCol = toolsHeader.findIndex(
      (h) => String(h).toLowerCase().trim() === "location",
    );

    const toolsImgCol = toolsHeader.findIndex(
      (h) => String(h).toLowerCase().trim() === "imageurl",
    );

    const tools = toolsData.map((r) => {
      return {
        code: String(r[0] || "").trim(),
        name: String(r[1] || "").trim(),
        category: String(r[2] || "").trim(),
        unit: String(r[3] || "").trim(),
        min: Number(r[4] || 0),
        stock: Number(r[5] || 0),
        location: toolsLocCol >= 0 ? String(r[toolsLocCol] || "").trim() : "",
        date: String(r[7] || "").trim(),
        remark: String(r[8] || "").trim(),
        imageUrl: (() => {
          const raw = toolsImgCol >= 0 ? String(r[toolsImgCol] || "").trim() : "";
          const list = _parseImageList(raw);
          return list[0] || "";
        })(),
        images: (() => {
          const raw = toolsImgCol >= 0 ? String(r[toolsImgCol] || "").trim() : "";
          return _parseImageList(raw);
        })(),
      };
    });

    const unitMap = {};
    items.forEach((i) => {
      unitMap[i.code] = i.unit;
    });
    tools.forEach((t) => {
      unitMap[t.code] = t.unit;
    });

    const logSheet = ss.getSheetByName("Logs");
    let history = [];
    if (logSheet && logSheet.getLastRow() > 1) {
      const limit = 500; // จำนวนประวัติย้อนหลังที่จะโหลดไปหน้าเว็บ
      const startRow = Math.max(2, logSheet.getLastRow() - limit + 1);
      const numRows = logSheet.getLastRow() - startRow + 1;
      // ดึง 9 คอลัมน์ (เผื่อมี Remark) เพื่อความสมบูรณ์
      const logData = logSheet
        .getRange(startRow, 1, numRows, Math.max(8, logSheet.getLastColumn()))
        .getValues();
      history = logData.reverse().map((r) => {
        return {
          time: formatDate(r[0]),
          code: String(r[1] || "").trim(),
          itemName: String(r[2] || "").trim(),
          amount: String(r[3] || "").trim(),
          balance: String(r[4] || "").trim(),
          action: String(r[6] || "").trim(),
          user: r[7] ? String(r[7]).trim() : "ไม่ระบุ",
          remark: r[8] ? String(r[8]).trim() : "",
          unit: unitMap[String(r[1] || "").trim()] || "",
        };
      });
    }

    const borrowRows = getData("BorrowRequests");
    const activeBorrows = borrowRows
      .filter((r) => String(r[9]).trim() === "approved")
      .map((r) => {
        return {
          reqId: String(r[0] || "").trim(),
          date: formatDate(r[1]),
          borrower: String(r[3] || "").trim(),
          itemCode: String(r[4] || "").trim(),
          itemName: String(r[5] || "").trim(),
          qty: Number(r[6] || 0),
          machine: r[7] ? String(r[7]).trim() : "-",
          remark: r[11] ? String(r[11]).trim() : "ยืมผ่านหน้างาน",
        };
      });

    const pendingPORows = getData("PendingPO");
    const pendingPOs = pendingPORows.map((r) => {
      return {
        poCode: String(r[0] || "").trim(),
        date: formatDate(r[1]),
        supplier: String(r[2] || "").trim(),
        itemCode: String(r[3] || "").trim(),
        itemName: String(r[4] || "").trim(),
        qty: Number(r[5] || 0),
        status: String(r[6] || "").trim(),
        remark: r[7] ? String(r[7]).trim() : "",
        fileUrl: r[8] ? String(r[8]).trim() : "",
      };
    });

    const usersData = getData("Users");
    const users = usersData.map((r) => {
      return {
        userId: String(r[0] || "").trim(),
        name: String(r[1] || "").trim(),
        role: String(r[2] || "").trim(),
      };
    });

    const settings = getSettings();

    const finalData = {
      items: items,
      tools: tools,
      history: history,
      activeBorrows: activeBorrows,
      pendingPOs: pendingPOs,
      users: users,
      settings: settings,
    };

    // ⚠️ บังคับแปลงข้อมูลทั้งหมดเป็น Plain Object เพื่อตัดปัญหาหน้าเว็บโหลดค้างจาก Date Format ของ Google Sheet
    return JSON.parse(JSON.stringify(finalData));
  } catch (e) {
    return {
      error: e.toString(),
      items: [],
      tools: [],
      history: [],
      activeBorrows: [],
      pendingPOs: [],
      users: [],
      settings: getDefaultSettings(),
    };
  }
}

// -------------------------------------------------------------------
// ตรวจสอบสิทธิ์จริงฝั่ง Server — ห้ามเชื่อ payload.role ที่ client ส่งมาเฉยๆ
// เพราะใครก็เปิด Console ส่ง payload ปลอม role:'admin' มาได้ ต้องเช็คจากชีต Users จริงเท่านั้น
// -------------------------------------------------------------------
function _getVerifiedRole(userId) {
  if (!userId) return null;
  const u = getUser(userId); // ใช้ getUser() เดิมของระบบ กันโค้ดอ่านชีต Users ซ้ำซ้อน
  return u ? String(u.role || "").trim() : null;
}

function _requireRole(userId, allowedRoles) {
  const role = _getVerifiedRole(userId);
  if (!role || allowedRoles.indexOf(role) === -1) {
    return {
      ok: false,
      error:
        "ไม่มีสิทธิ์ทำรายการนี้ (role จริงในระบบ: " +
        (role || "ไม่พบผู้ใช้") +
        ")",
    };
  }
  return { ok: true, role: role };
}

// -------------------------------------------------------------------
// API สำหรับ Web Dashboard
// -------------------------------------------------------------------

function webSaveSettings(payload) {
  try {
    const auth = _requireRole(payload.userId, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };
    const current = getSettings();
    const updated = { ...current, ...payload };
    PropertiesService.getScriptProperties().setProperty(
      "APP_SETTINGS",
      JSON.stringify(updated),
    );
    _writeAudit(
      "SETTINGS",
      `บันทึกการตั้งค่าระบบ`,
      payload.userName || "Admin",
      payload.userId || "-",
      "admin",
      "Web",
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ส่งแจ้งเตือน (Broadcast) ถึงเพื่อนทุกคนที่แอดไลน์บอทไว้ — การ์ด Flex ข้อความ + ปุ่มลิงก์
function webBroadcastMessage(payload) {
  payload = payload || {};
  try {
    const auth = _requireRole(payload.userId, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const message = String(payload.message || "").trim();
    if (!message)
      return { success: false, error: "กรุณากรอกข้อความที่จะแจ้งเตือน" };

    const btnLabel = String(payload.btnLabel || "").trim();
    const btnUrl = String(payload.btnUrl || "").trim();
    if (btnUrl && !/^https?:\/\//i.test(btnUrl)) {
      return {
        success: false,
        error: "ลิงก์ปุ่มต้องขึ้นต้นด้วย http:// หรือ https://",
      };
    }

    const settings = getSettings();
    const flexMsg = flexBroadcastCard(message, btnLabel, btnUrl, settings);

    const res = UrlFetchApp.fetch(
      "https://api.line.me/v2/bot/message/broadcast",
      {
        method: "post",
        headers: {
          Authorization: "Bearer " + getPrimaryToken(),
          "Content-Type": "application/json",
        },
        payload: JSON.stringify({ messages: [flexMsg] }),
        muteHttpExceptions: true,
      },
    );

    const code = res.getResponseCode();
    if (code !== 200) {
      return {
        success: false,
        error: "LINE API error (" + code + "): " + res.getContentText(),
      };
    }

    _writeAudit(
      "BROADCAST",
      `ส่งแจ้งเตือนถึงเพื่อนทุกคน: ${message.substring(0, 80)}`,
      payload.userName || "Admin",
      payload.userId || "-",
      "admin",
      "Web-Broadcast",
    );

    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// การ์ด Flex สำหรับ Broadcast — ข้อความ + ปุ่มลิงก์ (ปุ่มจะโชว์เฉพาะเมื่อมี URL)
function flexBroadcastCard(message, btnLabel, btnUrl, settings) {
  const tColor = settings.themeColor || THEME_COLOR;
  const sysName = settings.sysName || "คลังอะไหล่เมาท์เทน";

  const bodyContents = [
    { type: "text", text: message, size: "sm", color: "#555555", wrap: true },
  ];

  if (btnUrl) {
    bodyContents.push({
      type: "button",
      action: {
        type: "uri",
        label: (btnLabel || "📲 เปิดดู").substring(0, 40),
        uri: btnUrl,
      },
      style: "primary",
      color: tColor,
      height: "md",
      margin: "lg",
    });
  }

  return {
    type: "flex",
    altText: message.substring(0, 100),
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "📢 แจ้งเตือน",
            weight: "bold",
            size: "xl",
            color: "#FFFFFF",
          },
          {
            type: "text",
            text: sysName,
            size: "sm",
            color: "#FFFFFFCC",
            margin: "xs",
          },
        ],
        backgroundColor: tColor,
        paddingAll: "xl",
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "lg",
        contents: bodyContents,
        paddingAll: "xl",
      },
    },
  };
}

function webVerifyPin(pin) {
  const currentPin =
    PropertiesService.getScriptProperties().getProperty("WEB_PIN") || "1234";
  if (String(pin) === currentPin || String(pin) === "admin") {
    return true;
  }
  return false;
}

// webVerifyUserPin — ดูฟังก์ชันหลักด้านบน (บรรทัด ~194)

function webUpdatePin(newPin) {
  try {
    PropertiesService.getScriptProperties().setProperty(
      "WEB_PIN",
      String(newPin),
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webAdjustStock(code, qty, userName, userId) {
  try {
    const auth = _requireRole(userId, ["admin"]);
    if (!auth.ok) return auth;
    const displayUser = userName ? `${userName} (Web)` : "Web Dashboard";
    updateStock(code, qty, "ปรับยอด", displayUser);
    _writeAudit(
      "ปรับยอด",
      `ปรับยอดสต็อก (Web): [${code}] ${qty > 0 ? "+" : ""}${qty}`,
      userName || "Web Dashboard",
      userId || "-",
      "-",
      "Web",
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webAddPendingPO(poData) {
  try {
    // ✅ ตรวจสอบ items Array
    if (!poData.items || poData.items.length === 0) {
      return { success: false, error: "ไม่มีรายการสินค้า" };
    }
    // อัปโหลดไฟล์ PDF (ถ้ามี) แบบไม่บล็อกการบันทึก PO — ถ้าอัปโหลดพัง (เช่น FOLDER_ID
    // ผิด/ไม่มีสิทธิ์เข้าถึง) จะไม่ทำให้ทั้ง PO หายไป แค่บันทึกโดยไม่มีไฟล์แนบ พร้อมแจ้งเตือน
    let fileUrl = "";
    let fileUploadError = "";
    if (poData.pdfBase64) {
      try {
        const parentFolder = DriveApp.getFolderById(FOLDER_ID);
        const targetFolder = getSubFolder(parentFolder, "PO_Documents");
        const blob = Utilities.newBlob(
          Utilities.base64Decode(poData.pdfBase64),
          "application/pdf",
          poData.pdfName,
        );
        const file = targetFolder.createFile(blob);
        try {
          file.setSharing(
            DriveApp.Access.ANYONE_WITH_LINK,
            DriveApp.Permission.VIEW,
          );
        } catch (e) {}
        fileUrl = "https://drive.google.com/file/d/" + file.getId() + "/view";
      } catch (e) {
        fileUploadError = e.toString();
        fileUrl = "";
      }
    }
    let formattedDate = poData.date;
    try {
      const dt = new Date(poData.date);
      const d = String(dt.getDate()).padStart(2, "0");
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const y = String(dt.getFullYear() + 543).slice(-2);
      formattedDate = `${d}/${m}/${y}`;
    } catch (e) {}
    // ✅ วนลูปบันทึกแต่ละรายการ
    poData.items.forEach((item) => {
      sheet("PendingPO").appendRow([
        poData.poCode,
        formattedDate,
        poData.supplier,
        "-",
        item.itemName, // ✅ ใช้ item.itemName
        Number(item.qty), // ✅ ใช้ item.qty
        item.status, // ✅ ใช้ item.status
        poData.remark || "",
        fileUrl,
      ]);
    });
    if (fileUploadError) {
      return {
        success: true,
        fileUrl: fileUrl,
        warning:
          "บันทึก PO สำเร็จ แต่อัปโหลดไฟล์ PDF ไม่สำเร็จ (บันทึกโดยไม่มีไฟล์แนบ กรุณาตรวจสอบการตั้งค่าโฟลเดอร์ Drive แล้วแนบไฟล์ใหม่ทีหลังผ่านหน้าแก้ไข PO): " +
          fileUploadError,
      };
    }
    return { success: true, fileUrl: fileUrl };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}
function webReceivePO(poCode, userName, userId) {
  try {
    const sh = sheet("PendingPO");
    const data = sh.getDataRange().getValues();
    let updatedCount = 0;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(poCode).trim()) {
        sh.getRange(i + 1, 7).setValue("ได้รับแล้ว");
        updatedCount++;
      }
    }

    if (updatedCount === 0) {
      return { success: false, error: "ไม่พบรหัส PO นี้ในระบบ" };
    }
    _writeAudit(
      "RECEIVE_PO",
      `รับ PO: ${poCode}`,
      userName || "Admin",
      userId || "-",
      "-",
      "Web",
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// 1. webUpdatePendingPO()
function webUpdatePendingPO(poData) {
  try {
    if (!poData.poCode || !poData.items || poData.items.length === 0) {
      return { success: false, error: "ข้อมูล PO ไม่ครบถ้วน" };
    }

    // วันที่ที่ส่งมาจากหน้าแก้ไข เป็นค่าเดิมที่ format เป็น พ.ศ. ("dd/mm/yy") อยู่แล้วจากฝั่งหน้าเว็บ
    // (ฟิลด์นี้เป็น readonly ผู้ใช้แก้ไม่ได้) ไม่ต้องพยายาม parse ซ้ำด้วย new Date() เพราะรูปแบบ
    // "dd/mm/yy-พ.ศ." ไม่ใช่รูปแบบที่ JS แปลงได้ถูกต้อง ทำให้ได้ Invalid Date และวันที่หายไปแบบเงียบๆ
    let formattedDate = poData.date;

    // ⚠️ สำคัญ: ต้องอัปโหลดไฟล์ (ถ้ามี) และเตรียมแถวใหม่ให้เสร็จ "ก่อน" ที่จะลบแถวเก่าออกจากชีต
    // เดิมโค้ดลบแถวเก่าก่อนแล้วค่อยอัปโหลดไฟล์ทีหลัง ถ้าอัปโหลดพังระหว่างทาง แถวเก่าจะถูกลบไปแล้ว
    // และไม่มีการเขียนแถวใหม่กลับเข้าไป ทำให้ข้อมูล PO ทั้งตัวหายไปเลย นี่คือจุดที่แก้ไข

    // ถ้าผู้ใช้แนบไฟล์ PDF ใหม่มาด้วย ให้พยายามอัปโหลดไฟล์ใหม่แทนที่ไฟล์เดิม
    // ถ้าไม่ได้แนบไฟล์ใหม่ หรืออัปโหลดไม่สำเร็จ ให้ใช้ fileUrl เดิมที่ฝั่งหน้าเว็บส่งมาแทน (เก็บไฟล์เดิมไว้ ไม่ลบทิ้ง)
    // การอัปโหลดไฟล์พังจะไม่ทำให้การบันทึกข้อมูล PO ส่วนอื่น (วันที่/สถานะ/จำนวน) ล้มเหลวไปด้วย
    let fileUrl = poData.fileUrl || "";
    let fileUploadError = "";
    if (poData.pdfBase64) {
      try {
        const parentFolder = DriveApp.getFolderById(FOLDER_ID);
        const targetFolder = getSubFolder(parentFolder, "PO_Documents");
        const blob = Utilities.newBlob(
          Utilities.base64Decode(poData.pdfBase64),
          "application/pdf",
          poData.pdfName,
        );
        const file = targetFolder.createFile(blob);
        try {
          file.setSharing(
            DriveApp.Access.ANYONE_WITH_LINK,
            DriveApp.Permission.VIEW,
          );
        } catch (e) {}
        fileUrl = "https://drive.google.com/file/d/" + file.getId() + "/view";
      } catch (e) {
        // อัปโหลดไม่สำเร็จ: เก็บ error ไว้แจ้งผู้ใช้ แต่ไม่ยกเลิกการบันทึก และคง fileUrl เดิมไว้
        fileUploadError = e.toString();
        fileUrl = poData.fileUrl || "";
      }
    }

    // เตรียมแถวใหม่ทั้งหมดไว้ในหน่วยความจำก่อน ยังไม่เขียนอะไรลงชีต
    const newRows = poData.items.map((item) => [
      poData.poCode,
      formattedDate,
      poData.supplier,
      "-",
      item.itemName,
      Number(item.qty),
      item.status,
      poData.remark || "",
      fileUrl,
    ]);

    // ตอนนี้แถวใหม่พร้อมแล้ว 100% ค่อยลบแถวเก่าของ PO นี้ทิ้ง แล้วเขียนแถวใหม่กลับเข้าไปทันที
    const sh = sheet("PendingPO");
    const data = sh.getDataRange().getValues();
    const rowsToDelete = [];
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]).trim() === String(poData.poCode).trim()) {
        rowsToDelete.push(i);
      }
    }
    for (const rowIdx of rowsToDelete) {
      sh.deleteRow(rowIdx + 1);
    }

    newRows.forEach((row) => {
      sheet("PendingPO").appendRow(row);
    });

    if (fileUploadError) {
      return {
        success: true,
        fileUrl: fileUrl,
        warning:
          "บันทึกข้อมูล PO สำเร็จ แต่อัปโหลดไฟล์ PDF ใหม่ไม่สำเร็จ (เก็บไฟล์แนบเดิมไว้แทน): " +
          fileUploadError,
      };
    }
    return { success: true, fileUrl: fileUrl };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// 2. webDeletePendingPO() [Optional]
function webDeletePendingPO(poCode, adminUid) {
  try {
    const auth = _requireRole(adminUid, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };
    const sh = sheet("PendingPO");
    const data = sh.getDataRange().getValues();
    let deletedCount = 0;
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]).trim() === String(poCode).trim()) {
        sh.deleteRow(i + 1);
        deletedCount++;
      }
    }
    if (deletedCount === 0) {
      return { success: false, error: "ไม่พบ PO ที่ต้องการลบ" };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}
function webCancelPO(poCode, reason, userName, userId) {
  try {
    const sh = sheet("PendingPO");
    const data = sh.getDataRange().getValues();
    let cancelledCount = 0;

    // เปลี่ยนสถานะเป็น "ยกเลิก" แทนการลบ (เพื่อเก็บประวัติไว้)
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(poCode).trim()) {
        sh.getRange(i + 1, 7).setValue("ยกเลิกแล้ว");
        // บันทึกสาเหตุลงช่อง remark (คอลัมน์ 8)
        const existingRemark = String(data[i][7] || "").trim();
        const newRemark = existingRemark
          ? `${existingRemark} | ยกเลิก: ${reason}`
          : `ยกเลิก: ${reason}`;
        sh.getRange(i + 1, 8).setValue(newRemark);
        cancelledCount++;
      }
    }

    if (cancelledCount === 0) {
      return { success: false, error: "ไม่พบ PO นี้ในระบบ" };
    }

    // บันทึกลง Logs
    const now = new Date();
    const tzOffset = 7 * 60 * 60 * 1000;
    const localTime = new Date(now.getTime() + tzOffset);
    const pad = (n) => String(n).padStart(2, "0");
    const d = localTime;
    const isEn = false; // ใช้ พ.ศ.
    const thaiYear = String(d.getUTCFullYear() + 543).slice(-2);
    const timeStr = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${thaiYear} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

    sheet("Logs").appendRow([
      new Date(),
      poCode,
      `PO ${poCode}`,
      "-",
      "-",
      "WEB",
      "ยกเลิก PO",
      `${userName || "Admin"} — สาเหตุ: ${reason}`,
    ]);

    _writeAudit(
      "CANCEL_PO",
      `ยกเลิก PO: ${poCode} — สาเหตุ: ${reason}`,
      userName || "Admin",
      userId || "-",
      "-",
      "Web",
    );

    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webTransaction(payload) {
  // ตรวจสอบเวลาทำการ (ยกเว้นการ "รับเข้า" ซึ่งมักทำโดยแอดมิน/สต๊าฟนอกเวลาได้)
  if (payload.mode !== "รับเข้า") {
    const whCheck = _checkWorkingHours();
    if (!whCheck.ok) return { success: false, error: whCheck.error };
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000))
    return { success: false, error: "คิวระบบเต็ม กรุณาลองใหม่อีกครั้ง" };
  try {
    // ตรวจสอบระบบซ่อมแซมเครื่องมือ
    if (
      payload.user &&
      payload.user.includes("ซ่อมแซมแล้ว") &&
      payload.mode === "รับเข้า"
    ) {
      payload.mode = "ซ่อมแซมแล้ว";
      const logSheet = sheet("Logs");
      const logsData = logSheet.getDataRange().getValues();
      let qtyToClear = Number(payload.qty);
      for (let i = logsData.length - 1; i > 0; i--) {
        if (qtyToClear <= 0) break;
        const logCode = String(logsData[i][1]).trim();
        const logAction = String(logsData[i][6]).trim();
        const logUser = String(logsData[i][7]).trim();
        if (
          logCode === String(payload.code).trim() &&
          (logAction === "เบิก" || logAction === "แจ้งชำรุด") &&
          logUser.includes("ชำรุด")
        ) {
          const newUserStr = logUser.replace(/ชำรุด/g, "เคลียร์ซ่อมแล้ว");
          logSheet.getRange(i + 1, 8).setValue(newUserStr);
          const logQty =
            parseInt(String(logsData[i][3]).replace(/[^0-9]/g, "")) || 1;
          qtyToClear -= logQty;
        }
      }
    }
    const itemInfo = getItemInfo(payload.code);
    if (!itemInfo.code) return { success: false, error: "ไม่พบข้อมูลในระบบ" };
    if (!Number.isInteger(Number(payload.qty)) || Number(payload.qty) < 1)
      return { success: false, error: "จำนวนต้องเป็นจำนวนเต็มอย่างน้อย 1" };
    if (
      (payload.mode === "เบิก" || payload.mode === "แจ้งชำรุด") &&
      itemInfo.stock < Number(payload.qty)
    ) {
      return { success: false, error: `สต็อกไม่พอ! (มี: ${itemInfo.stock})` };
    }
    // ตั้งค่าเวลาเป็นเขตเวลาประเทศไทย (GMT+7) ป้องกันการขึ้น 07:00
    const now = new Date();
    const tzOffset = 7 * 60 * 60 * 1000;
    const localTime = new Date(now.getTime() + tzOffset);

    // ทำการอัปเดตสต็อกจริง (ในนี้จะบันทึกประวัติลงชีต Logs 1 รอบตามปกติอยู่แล้ว)
    updateStock(
      payload.code,
      Number(payload.qty),
      payload.mode,
      payload.user || "Web User",
      payload.remark || "",
    );

    const transId =
      (payload.mode === "รับเข้า" || payload.mode === "ซ่อมแซมแล้ว"
        ? "RC"
        : "WD") + Date.now();

    // บันทึกลงชีต Receives หรือ Requests เพื่อเป็นหลักฐานเท่านั้น
    if (payload.mode === "รับเข้า" || payload.mode === "ซ่อมแซมแล้ว") {
      sheet("Receives").appendRow([
        transId,
        localTime,
        "WEB",
        payload.user,
        payload.mode,
        payload.code,
        itemInfo.name,
        payload.qty,
        itemInfo.category,
        payload.remark || "Web Dashboard",
        "approved",
      ]);
    } else {
      sheet("Requests").appendRow([
        transId,
        localTime,
        "WEB",
        payload.user,
        payload.code,
        itemInfo.name,
        payload.qty,
        itemInfo.category,
        payload.remark || "Web Dashboard",
      ]);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  } finally {
    lock.releaseLock();
  }
}
function webAddNewItems(payloads) {
  try {
    if (!Array.isArray(payloads) || payloads.length === 0)
      return { success: false, error: "ข้อมูลไม่ครบถ้วน" };

    const auth = _requireRole(payloads[0].userId, ["admin"]);
    if (!auth.ok) return auth;

    let successCount = 0;
    let errorCount = 0;
    let errors = [];

    // ตั้งค่าเวลาไทย GMT+7
    const now = new Date();
    const tzOffset = 7 * 60 * 60 * 1000;
    const localTime = new Date(now.getTime() + tzOffset);

    payloads.forEach((payload, index) => {
      try {
        if (!payload.code || !payload.name)
          throw new Error(`รายการที่ ${index + 1}: ข้อมูลไม่ครบ`);

        const sh = sheet(payload.type === "Tools" ? "Tools" : "Items");
        const existing = sh.getDataRange().getValues();

        for (let i = 1; i < existing.length; i++) {
          if (String(existing[i][0]).trim() === String(payload.code).trim()) {
            throw new Error(`รหัสซ้ำในระบบ (${payload.code})`);
          }
          if (String(existing[i][1]).trim().toLowerCase() === String(payload.name).trim().toLowerCase()) {
            throw new Error(`ชื่อรายการซ้ำในระบบ (${payload.name})`);
          }
        }

        // ตรวจสอบ / สร้าง header imageUrl ถ้ายังไม่มี
        const headers = existing.length > 0 ? existing[0] : [];
        let imgColIdx = headers.findIndex(
          (h) => String(h).toLowerCase().trim() === "imageurl",
        );
        if (imgColIdx < 0) {
          imgColIdx = headers.length;
          sh.getRange(1, imgColIdx + 1).setValue("imageUrl");
        }

        // 1. บันทึกข้อมูลลงชีตหลัก (Items หรือ Tools) — รวม imageUrl ด้วย
        const newRow = [
          payload.code,
          payload.name,
          payload.category,
          payload.unit,
          Number(payload.min) || 0,
          Number(payload.qty) || 0,
          payload.location || "",
          localTime,
          payload.remark || "",
        ];
        // เติม cell ว่างให้ถึง column imageUrl แล้วใส่ "" (รูปจะถูก upload แยกทีหลัง)
        while (newRow.length <= imgColIdx) newRow.push("");
        sh.appendRow(newRow);

        // 2. บันทึกข้อมูลลงชีต Logs
        sheet("Logs").appendRow([
          now,
          payload.code,
          payload.name,
          "+" + payload.qty,
          payload.qty,
          "WEB",
          "New Item",
          payload.user,
          payload.remark || "",
        ]);

        _writeAudit(
          "NEW_ITEM",
          `เพิ่มสินค้าใหม่: [${payload.code}] ${payload.name} จำนวน ${payload.qty} (${payload.type || "Items"})${payload.remark ? " | " + payload.remark : ""}`,
          payload.user || "Web",
          "-",
          "-",
          "Web",
        );

        successCount++;
      } catch (e) {
        errorCount++;
        errors.push(e.toString());
      }
    });

    if (errorCount > 0) {
      return {
        success: false,
        error: `บันทึกสำเร็จ ${successCount} รายการ, ล้มเหลว ${errorCount} รายการ: ${errors.join("; ")}`,
      };
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webEditItem(payload) {
  try {
    const auth = _requireRole(payload.userId, ["admin"]);
    if (!auth.ok) return auth;

    const targetSheet = payload.type === "tool" ? "Tools" : "Items";
    const sh = sheet(targetSheet);
    const data = sh.getDataRange().getValues();
    const headers = data[0];

    // หา location column จาก header row (รองรับทั้ง sheet ที่มีและไม่มี location)
    let locationColIdx = headers.findIndex(
      (h) => String(h).toLowerCase().trim() === "location",
    );
    // ถ้าไม่เจอ header → ถ้า sheet มีคอลัมน์ >= 7 ก็ใช้คอลัมน์ G (index 6), ไม่งั้นเพิ่มคอลัมน์ใหม่
    if (locationColIdx < 0) {
      if (data[0].length >= 7) {
        locationColIdx = 6; // คอลัมน์ G
      } else {
        // เพิ่ม header location ที่คอลัมน์ถัดไป
        locationColIdx = data[0].length;
        sh.getRange(1, locationColIdx + 1).setValue("location");
      }
    }

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(payload.code).trim()) {
        sh.getRange(i + 1, 2).setValue(payload.name);
        sh.getRange(i + 1, 3).setValue(payload.category);
        sh.getRange(i + 1, 4).setValue(payload.unit);
        sh.getRange(i + 1, 5).setValue(payload.min);
        sh.getRange(i + 1, locationColIdx + 1).setValue(payload.location || "");
        _writeAudit(
          "EDIT_ITEM",
          `แก้ไขข้อมูลสินค้า: [${payload.code}] ${payload.name} หมวด:${payload.category} หน่วย:${payload.unit} Min:${payload.min}`,
          payload.userName || "Web Admin",
          payload.userId || "-",
          payload.userRole || "-",
          "Web",
        );
        return { success: true };
      }
    }
    return { success: false, error: "ไม่พบรหัสสินค้านี้ในระบบ" };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ═══════════════════════════════════════════════════════
//  webSaveItemImage — อัปโหลดรูปอะไหล่ (base64) → Drive
//  เรียกจาก Web Dashboard เพื่อบันทึก URL ลงคอลัมน์ imageUrl
// ═══════════════════════════════════════════════════════
function webSaveItemImage(payload) {
  try {
    if (!payload || !payload.code || !payload.base64) {
      return { success: false, error: "ข้อมูลไม่ครบ (code / base64)" };
    }

    // --- อัปโหลดไฟล์ไปยัง Drive ---
    const mimeType = payload.mimeType || "image/jpeg";
    const ext = mimeType.includes("png")
      ? ".png"
      : mimeType.includes("webp")
        ? ".webp"
        : ".jpg";
    const fileName = "ITEM_" + payload.code + "_" + Date.now() + ext;

    const bytes = Utilities.base64Decode(payload.base64);
    const blob = Utilities.newBlob(bytes, mimeType, fileName);

    const parentFolder = DriveApp.getFolderById(FOLDER_ID);
    const imgFolder = getSubFolder(parentFolder, "Images_Items");
    const file = imgFolder.createFile(blob);
    try {
      file.setSharing(
        DriveApp.Access.ANYONE_WITH_LINK,
        DriveApp.Permission.VIEW,
      );
    } catch (e) {}
    // ใช้ thumbnail URL แทน uc?export=view เพื่อหลีกเลี่ยงปัญหา CORS/redirect
    const fileId = file.getId();
    const imageUrl =
      "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w400";

    // --- บันทึก URL ลงชีต (Items หรือ Tools) ---
    const targetSheet = payload.type === "tool" ? "Tools" : "Items";
    const sh = sheet(targetSheet);
    const data = sh.getDataRange().getValues();
    const header = data[0];

    // หา / สร้างคอลัมน์ imageUrl
    let imgColIdx = header.findIndex(
      (h) => String(h).toLowerCase().trim() === "imageurl",
    );
    if (imgColIdx < 0) {
      imgColIdx = header.length;
      sh.getRange(1, imgColIdx + 1).setValue("imageUrl");
    }

    // หาแถวของ item และอัปเดต
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(payload.code).trim()) {
        const currentVal = String(data[i][imgColIdx] || "").trim();
        const urls = currentVal ? currentVal.split(",") : [];
        const idx = payload.imageIndex !== undefined ? parseInt(payload.imageIndex) : 0;
        urls[idx] = imageUrl;

        const newVal = urls.filter((x) => x && x !== "-").join(",");
        sh.getRange(i + 1, imgColIdx + 1).setValue(newVal);
        _writeAudit(
          "ITEM_IMAGE",
          `อัปโหลดรูป (${idx + 1}): [${payload.code}]`,
          payload.userName || "Web Admin",
          payload.userId || "-",
          "-",
          "Web",
        );
        return { success: true, imageUrl: newVal };
      }
    }
    return { success: false, error: "ไม่พบรหัสสินค้า " + payload.code };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ═══════════════════════════════════════════════════════
//  webDeleteItemImage — ลบรูปอะไหล่ที่กำหนด (ตามดัชนี)
// ═══════════════════════════════════════════════════════
function webDeleteItemImage(payload) {
  try {
    if (!payload || !payload.code) {
      return { success: false, error: "ข้อมูลไม่ครบ (code)" };
    }
    const auth = _requireRole(payload.userId, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const targetSheet = payload.type === "tool" ? "Tools" : "Items";
    const sh = sheet(targetSheet);
    const data = sh.getDataRange().getValues();
    const header = data[0];

    let imgColIdx = header.findIndex(
      (h) => String(h).toLowerCase().trim() === "imageurl",
    );
    if (imgColIdx < 0) {
      return { success: false, error: "ไม่พบคอลัมน์ imageUrl" };
    }

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(payload.code).trim()) {
        const currentVal = String(data[i][imgColIdx] || "").trim();
        const urls = currentVal ? currentVal.split(",") : [];
        const idx = payload.imageIndex !== undefined ? parseInt(payload.imageIndex) : 0;
        if (idx >= 0 && idx < urls.length) {
          urls.splice(idx, 1);
        }

        const newVal = urls.filter((x) => x && x !== "-").join(",");
        sh.getRange(i + 1, imgColIdx + 1).setValue(newVal || "");
        _writeAudit(
          "ITEM_IMAGE_DELETE",
          `ลบรูป (${idx + 1}): [${payload.code}]`,
          payload.userName || "Web Admin",
          payload.userId || "-",
          "-",
          "Web",
        );
        return { success: true, imageUrl: newVal };
      }
    }
    return { success: false, error: "ไม่พบรหัสสินค้า " + payload.code };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ═══════════════════════════════════════════════════════
//  webSaveProfileImage — อัปโหลดรูปโปรไฟล์ผู้ใช้ (base64) → Drive
//  เรียกจากหน้า qr.gs (เมนูผู้ใช้) เพื่อบันทึก URL ลงคอลัมน์ photoUrl ของชีต Users
// ═══════════════════════════════════════════════════════
function webSaveProfileImage(payload) {
  try {
    if (!payload || !payload.uid || !payload.base64) {
      return { success: false, error: "ข้อมูลไม่ครบ (uid / base64)" };
    }

    const mimeType = payload.mimeType || "image/jpeg";
    const ext = mimeType.includes("png")
      ? ".png"
      : mimeType.includes("webp")
        ? ".webp"
        : ".jpg";
    const fileName = "PROFILE_" + payload.uid + "_" + Date.now() + ext;

    const bytes = Utilities.base64Decode(payload.base64);
    const blob = Utilities.newBlob(bytes, mimeType, fileName);

    const parentFolder = DriveApp.getFolderById(FOLDER_ID);
    const imgFolder = getSubFolder(parentFolder, "Images_Profiles");
    const file = imgFolder.createFile(blob);
    try {
      file.setSharing(
        DriveApp.Access.ANYONE_WITH_LINK,
        DriveApp.Permission.VIEW,
      );
    } catch (e) {}
    const fileId = file.getId();
    const photoUrl =
      "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w400";

    const sh = sheet("Users");
    const data = sh.getDataRange().getValues();
    const headers = data[0];

    let photoColIdx = headers.findIndex(
      (h) => String(h).toLowerCase().trim() === "photourl",
    );
    if (photoColIdx < 0) {
      photoColIdx = headers.length;
      sh.getRange(1, photoColIdx + 1).setValue("photoUrl");
    }

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(payload.uid).trim()) {
        sh.getRange(i + 1, photoColIdx + 1).setValue(photoUrl);
        _writeAudit(
          "PROFILE_IMAGE",
          `อัปโหลดรูปโปรไฟล์`,
          payload.userName || "-",
          payload.uid,
          "-",
          "Web",
        );
        return { success: true, photoUrl: photoUrl };
      }
    }
    return { success: false, error: "ไม่พบผู้ใช้งานนี้ในระบบ" };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webUpdateUser(payload) {
  try {
    const auth = _requireRole(payload.actorUserId, ["admin"]);
    if (!auth.ok) return auth;

    updateUserRole(payload.userId, payload.role);
    let msgs = "";
    if (payload.role === "user") {
      msgs =
        "✅ บัญชีของคุณได้รับการอนุมัติจาก Web Admin แล้ว!\nพิมพ์ 'เมนู' เพื่อเริ่มใช้งานได้เลยครับ";
    } else if (payload.role === "rejected") {
      msgs = "❌ คำขอใช้งาน/บัญชีของคุณถูกระงับโดย Web Admin";
    } else if (payload.role === "admin") {
      msgs = "👑 บัญชีของคุณได้รับการเลื่อนขั้นเป็น Admin เรียบร้อยแล้ว!";
    }

    if (msgs !== "") {
      push(payload.userId, [{ type: "text", text: msgs }]);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webAddBorrow(payload) {
  try {
    const info = getItemInfo(payload.code);
    if (!info.code) {
      return { success: false, error: "ไม่พบข้อมูลสินค้า" };
    }
    if (!Number.isInteger(Number(payload.qty)) || Number(payload.qty) < 1) {
      return { success: false, error: "จำนวนต้องเป็นจำนวนเต็มอย่างน้อย 1" };
    }
    if (info.stock < Number(payload.qty)) {
      return { success: false, error: "สต็อกไม่พอ!" };
    }

    const settings = getSettings();

    // ── โหมด autoApprove ปิดอยู่ (ค่าเริ่มต้น) → ต้องรอแอดมินอนุมัติก่อน ไม่ตัดสต็อกทันที ──
    if (!settings.autoApprove) {
      const reqId = "WT" + Date.now();
      const ts = getThaiNow();
      sheet("WebPendingRequests").appendRow([
        reqId,
        ts,
        "WEB",
        payload.borrower,
        payload.code,
        info.name,
        payload.qty,
        info.category,
        info.unit,
        "ยืม",
        payload.remark || "ยืมผ่านหน้าเว็บ",
        "pending",
        "",
        "",
      ]);

      _writeAudit(
        "ยืม (รออนุมัติ)",
        `ขอยืมสินค้า (Web): [${payload.code}] ${info.name} จำนวน ${payload.qty}${payload.machine ? " | เครื่อง: " + payload.machine : ""}${payload.remark ? " | " + payload.remark : ""}`,
        payload.borrower,
        "-",
        "-",
        "Web",
      );

      try {
        const flex = {
          type: "flex",
          altText: "คำขอยืม (จากหน้าเว็บ)",
          contents: {
            type: "bubble",
            header: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "text",
                  text: "🛠️ คำขอยืม (จากหน้าเว็บ Dashboard)",
                  weight: "bold",
                  color: "#FFFFFF",
                },
              ],
              backgroundColor: "#E67E22",
              paddingAll: "md",
            },
            body: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "text",
                  text: `${payload.borrower} ขอยืม ${info.name} (${payload.qty} ${info.unit})`,
                  wrap: true,
                },
              ],
            },
            footer: {
              type: "box",
              layout: "horizontal",
              spacing: "md",
              contents: [
                {
                  type: "button",
                  action: {
                    type: "postback",
                    label: "❌ ปฏิเสธ",
                    data: "webtx_reject:" + reqId,
                    displayText: "❌ ปฏิเสธการยืม",
                  },
                  style: "secondary",
                  color: COLOR_DANGER,
                },
                {
                  type: "button",
                  action: {
                    type: "postback",
                    label: "✅ อนุมัติ",
                    data: "webtx_approve:" + reqId,
                    displayText: "✅ อนุมัติการยืม",
                  },
                  style: "primary",
                  color: COLOR_SUCCESS,
                },
              ],
            },
          },
        };
        const allUsers = sheet("Users").getDataRange().getValues().slice(1);
        const admins = allUsers.filter((r) => r[2] === "admin");
        _pushApprovalToAdmins(admins, [flex]);
      } catch (e) {
        // ถ้าส่งการ์ดไม่สำเร็จ คำขอยังอยู่ในสถานะ pending ให้แอดมินเข้าไปกดอนุมัติในหน้าเว็บได้เหมือนเดิม
      }

      return { success: true, pending: true };
    }

    // ── โหมด autoApprove เปิดอยู่ → ตัดสต็อกทันทีตามพฤติกรรมเดิม ──
    updateStock(payload.code, Number(payload.qty), "ยืม", payload.borrower);
    const ts = getThaiNow();
    sheet("BorrowRequests").appendRow([
      "BW" + Date.now(),
      ts,
      "WEB",
      payload.borrower,
      payload.code,
      info.name,
      payload.qty,
      payload.machine || "-",
      "Web Dashboard",
      "approved",
      ts,
      payload.remark || "ยืมผ่านหน้าเว็บ",
    ]);

    _writeAudit(
      "ยืม",
      `ยืมสินค้า (Web): [${payload.code}] ${info.name} จำนวน ${payload.qty}${payload.machine ? " | เครื่อง: " + payload.machine : ""}${payload.remark ? " | " + payload.remark : ""}`,
      payload.borrower,
      "-",
      "-",
      "Web",
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function getUserHistory(uid) {
  try {
    if (!uid) return { success: false, error: "ไม่พบ uid" };
    const ss = getActiveSpreadsheetInstance();

    // 1. สร้าง Map สำหรับรูปภาพสินค้าจริง
    const imageMap = {};
    ["Items", "Tools"].forEach(function (shName) {
      const sh = ss.getSheetByName(shName);
      if (!sh) return;
      const allRows = sh.getDataRange().getValues();
      const header = allRows[0];
      const codeIdx = header.findIndex(function (h) {
        return String(h).toLowerCase().trim() === "code";
      });
      const imgIdx = header.findIndex(function (h) {
        return String(h).toLowerCase().trim() === "imageurl";
      });
      if (codeIdx < 0 || imgIdx < 0) return;
      allRows.slice(1).forEach(function (r) {
        if (r[codeIdx])
          imageMap[String(r[codeIdx]).trim()] = String(r[imgIdx] || "");
      });
    });

    // 2. หา userName จาก uid
    const userSh = ss.getSheetByName("Users");
    let userName = "";
    if (userSh) {
      const uRows = userSh.getDataRange().getValues().slice(1);
      const uRow = uRows.find(function (r) {
        return String(r[0]) === uid;
      });
      if (uRow) userName = String(uRow[1] || "");
    }

    let history = [];

    // 3. อ่านรายการ Logs ทั้งหมดจากชีต Logs เพื่อสร้างประวัติแบบไม่มีรายการซ้ำ
    const logSh = ss.getSheetByName("Logs");
    if (!logSh || !userName) {
      return { success: true, history: [] };
    }
    
    // โหลดข้อมูลจาก Withdraws และ BorrowRequests ไว้เปรียบเทียบหาลายเซ็น
    const wdSh = ss.getSheetByName("Withdraws");
    const wdRows = wdSh ? wdSh.getDataRange().getValues() : [];
    let wdHeader = [];
    let wdData = [];
    if (wdRows.length > 0) {
      wdHeader = wdRows[0];
      wdData = wdRows.slice(1);
    }
    const wdUserIdx = wdHeader.findIndex(function (h) { return String(h).toLowerCase().trim() === "name"; });
    const wdCodeIdx = wdHeader.findIndex(function (h) { return String(h).toLowerCase().trim() === "itemcode"; });
    const wdQtyIdx = wdHeader.findIndex(function (h) { return String(h).toLowerCase().trim() === "qty"; });
    const wdSigIdx = wdHeader.indexOf("SignatureUrl");
    
    const brSh = ss.getSheetByName("BorrowRequests");
    const brRows = brSh ? brSh.getDataRange().getValues() : [];
    let brHeader = [];
    let brData = [];
    if (brRows.length > 0) {
      brHeader = brRows[0];
      brData = brRows.slice(1);
    }
    const brUserIdx = brHeader.findIndex(function (h) { return String(h).toLowerCase().trim() === "borrower"; });
    const brCodeIdx = brHeader.findIndex(function (h) { return String(h).toLowerCase().trim() === "itemcode"; });
    const brQtyIdx = brHeader.findIndex(function (h) { return String(h).toLowerCase().trim() === "qty"; });
    const brSigIdx = brHeader.indexOf("SignatureUrl");

    const logRows = logSh.getDataRange().getValues();
    const logHeader = logRows[0];
    const lTimeIdx = 0;
    const lCodeIdx = 1;
    
    // detect format: ถ้า column 2 เป็น string ชื่อ → format ใหม่
    //                ถ้า column 2 เป็น number    → format เก่า
    const sampleRow = logRows.length > 1 ? logRows[1] : null;
    const isNewFmt = sampleRow && isNaN(parseFloat(sampleRow[2]));
    const lChangeIdx = isNewFmt ? 3 : 2;
    const lActionIdx = isNewFmt ? 6 : 6;
    const lUserIdx = isNewFmt ? 7 : 7;
    const lRemarkIdx = isNewFmt ? 8 : 8;
    const lItemIdx = isNewFmt ? 2 : logHeader.length > 6 ? 6 : 2;

    const withdrawActions = ["เบิก", "withdraw", "เบิกออก", "borrow", "ยืม", "fast track", "qr"];
    const skipActions = ["รับเข้า", "new item", "ซ่อม", "adjust", "คืน", "receive"];

    logRows.slice(1).forEach(function (r) {
      if (String(r[lUserIdx] || "") !== userName) return;
      const action = String(r[lActionIdx] || "").toLowerCase().trim();
      
      // ข้าม action รับเข้า/new item/adjust
      if (skipActions.some(function (a) { return action.indexOf(a) >= 0; })) return;
      
      const change = parseFloat(String(r[lChangeIdx] || "0").replace(/[^0-9.\-]/g, ""));
      const isWithdraw = withdrawActions.some(function (a) { return action.indexOf(a) >= 0; }) || change < 0;
      if (!isWithdraw) return;

      const date = r[lTimeIdx] ? new Date(r[lTimeIdx]) : null;
      const code = String(r[lCodeIdx] || "-").trim();
      const qtyStr = String(Math.abs(change));
      const logTime = date ? date.getTime() : 0;
      const isWd = action.indexOf("ยืม") < 0 && action.indexOf("borrow") < 0;
      
      let signatureUrl = "";
      
      if (isWd) {
        // หา Signature ใน Withdraws
        const match = wdData.find(function (row) {
          const rowUser = String(row[wdUserIdx >= 0 ? wdUserIdx : 3]).trim();
          const rowCode = String(row[wdCodeIdx >= 0 ? wdCodeIdx : 4]).trim();
          const rowQty = String(row[wdQtyIdx >= 0 ? wdQtyIdx : 6]).trim();
          
          if (rowCode === code && parseFloat(rowQty) === parseFloat(qtyStr) && rowUser === userName) {
            const rowTime = row[1] instanceof Date ? row[1].getTime() : new Date(row[1]).getTime();
            return Math.abs(logTime - rowTime) < 180000; // ภายใน 3 นาที
          }
          return false;
        });
        if (match) {
          if (wdSigIdx >= 0 && match[wdSigIdx]) {
            signatureUrl = String(match[wdSigIdx]).trim();
          } else if (match[8] && String(match[8]).indexOf("http") === 0) {
            signatureUrl = String(match[8]).trim();
          }
        }
      } else {
        // หา Signature ใน BorrowRequests
        const match = brData.find(function (row) {
          const rowUser = String(row[brUserIdx >= 0 ? brUserIdx : 3]).trim();
          const rowCode = String(row[brCodeIdx >= 0 ? brCodeIdx : 4]).trim();
          const rowQty = String(row[brQtyIdx >= 0 ? brQtyIdx : 6]).trim();
          
          if (rowCode === code && parseFloat(rowQty) === parseFloat(qtyStr) && rowUser === userName) {
            const rowTime = row[1] instanceof Date ? row[1].getTime() : new Date(row[1]).getTime();
            return Math.abs(logTime - rowTime) < 180000; // ภายใน 3 นาที
          }
          return false;
        });
        if (match) {
          if (brSigIdx >= 0 && match[brSigIdx]) {
            signatureUrl = String(match[brSigIdx]).trim();
          } else if (match[12] && String(match[12]).indexOf("http") === 0) {
            signatureUrl = String(match[12]).trim();
          }
        }
      }

      history.push({
        date: date ? Utilities.formatDate(date, "Asia/Bangkok", "dd/MM/yyyy HH:mm") : "-",
        ts: logTime,
        itemCode: code,
        itemName: String(r[lItemIdx] || "-"),
        qty: qtyStr,
        type: isWd ? "เบิก" : "ยืม",
        remark: String(r[lRemarkIdx] || ""),
        imageUrl: imageMap[code] || "",
        signatureUrl: signatureUrl
      });
    });

    history.sort(function (a, b) { return b.ts - a.ts; });
    history = history.slice(0, 100).map(function (h) {
      delete h.ts;
      return h;
    });

    // ── BorrowRequests filter ──
    const borrowSh = ss.getSheetByName("BorrowRequests");
    let activeBorrows = [];
    if (borrowSh) {
      borrowSh
        .getDataRange()
        .getValues()
        .slice(1)
        .forEach(function (r) {
          if (!userName || String(r[3]) !== userName) return;
          const status = String(r[9] || "").toLowerCase();
          if (status === "returned" || status === "rejected") return;
          const dateVal = r[1] ? new Date(r[1]) : null;
          const daysAgo = dateVal ? Math.floor((new Date() - dateVal) / 86400000) : 0;
          const code = String(r[4] || "-").trim();
          activeBorrows.push({
            reqId: String(r[0] || "-"),
            borrowDate: dateVal ? Utilities.formatDate(dateVal, "Asia/Bangkok", "dd/MM/yyyy") : "-",
            itemCode: code,
            itemName: String(r[5] || "-"),
            qty: String(r[6] || "-"),
            unit: "",
            imageUrl: imageMap[code] || "",
          });
        });
    }

    return { success: true, history: history, activeBorrows: activeBorrows };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webReturnItem(reqId, userName, userId) {
  try {
    const sh = sheet("BorrowRequests");
    const rows = sh.getDataRange().getValues();
    const idx = rows.findIndex(
      (r) => String(r[0]).trim() === String(reqId).trim(),
    );
    if (idx < 0) {
      return { success: false, error: "ไม่พบรายการยืมนี้ในระบบ" };
    }
    if (String(rows[idx][9]).trim() !== "approved") {
      return { success: false, error: "รายการนี้ไม่ได้อยู่ในสถานะกำลังยืม" };
    }
    const itemCode = rows[idx][4];
    const qty = Number(rows[idx][6]);
    const borrowerName = rows[idx][3];
    const displayUser = userName ? `${userName} (Web)` : "Web Dashboard";
    // เปลี่ยนสถานะในชีต BorrowRequests เป็น returned (คืนแล้ว)
    const returnedAt = getThaiNow();
    sh.getRange(idx + 1, 10).setValue("returned");
    sh.getRange(idx + 1, 11).setValue(returnedAt);
    // คืนสต็อก
    updateStock(itemCode, qty, "คืน", `${displayUser} (${borrowerName})`);
    // บันทึกหลักฐานลง ReturnLogs
    const info = getItemInfo(itemCode);
    sheet("ReturnLogs").appendRow([
      "RT" + Date.now(),
      getThaiNow(),
      "WEB",
      userName || "Web Admin",
      itemCode,
      info.name,
      qty,
      "-",
      reqId,
    ]);

    _writeAudit(
      "คืน",
      `คืนสินค้า: [${itemCode}] ${info.name} จำนวน ${qty} | ผู้ยืม: ${borrowerName} | reqId: ${reqId}`,
      userName || "Web Admin",
      userId || "-",
      "-",
      "Web",
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webGetBackupData() {
  try {
    const ss = getActiveSpreadsheetInstance();
    let backupData = {};
    const sheets = ss.getSheets();
    for (let i = 0; i < sheets.length; i++) {
      const sh = sheets[i];
      backupData[sh.getName()] = sh.getDataRange().getDisplayValues();
    }
    return { success: true, data: JSON.stringify(backupData) };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webClearLogs(uid, pin) {
  try {
    if (!webVerifyUserPin(uid, pin))
      return {
        success: false,
        error: "รหัสผ่านไม่ถูกต้อง หรือคุณไม่มีสิทธิ์ทำรายการนี้",
      };
    const user = getUser(uid);
    if (!user || user.role !== "admin")
      return { success: false, error: "สิทธิ์ไม่เพียงพอ (เฉพาะ Admin)" };
    const logSheet = getActiveSpreadsheetInstance().getSheetByName("Logs");
    if (logSheet && logSheet.getLastRow() > 1) {
      logSheet
        .getRange(2, 1, logSheet.getLastRow() - 1, logSheet.getLastColumn())
        .clearContent();
    }
    _writeAudit(
      "SETTINGS",
      `ล้าง Logs ทั้งหมด`,
      user.name,
      uid,
      "admin",
      "Web",
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webFactoryReset(uid, pin) {
  try {
    if (!webVerifyUserPin(uid, pin))
      return {
        success: false,
        error: "รหัสผ่านไม่ถูกต้อง หรือคุณไม่มีสิทธิ์ทำรายการนี้",
      };
    const user = getUser(uid);
    if (!user || user.role !== "admin")
      return { success: false, error: "สิทธิ์ไม่เพียงพอ (เฉพาะ Admin)" };

    const ss = getActiveSpreadsheetInstance();
    const sheetsToClear = [
      "Items",
      "Tools",
      "Withdraws",
      "Requests",
      "Receives",
      "BorrowRequests",
      "ReturnLogs",
      "AdjustLogs",
      "Logs",
      "PendingPO",
      "AuditLog",
    ];
    sheetsToClear.forEach((shName) => {
      const sh = ss.getSheetByName(shName);
      if (sh && sh.getLastRow() > 1) {
        sh.getRange(
          2,
          1,
          sh.getLastRow() - 1,
          sh.getLastColumn(),
        ).clearContent();
      }
    });
    // บันทึก AuditLog หลัง Factory Reset (เขียนลงตรงๆ เพราะชีตถูกล้างไปแล้ว)
    _writeAudit(
      "FACTORY_RESET",
      "ล้างข้อมูลระบบทั้งหมด (Factory Reset)",
      user.name,
      uid,
      "admin",
      "Web",
      "WARNING",
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

/* ============================================================
   CENTRALIZED AUDIT LOG — เก็บใน Sheet "AuditLog"
   คอลัมน์: timestamp | type | user | userId | role | detail | device | status
============================================================ */
function _getOrCreateAuditSheet() {
  const ss = getActiveSpreadsheetInstance();
  let sh = ss.getSheetByName("AuditLog");
  if (!sh) {
    sh = ss.insertSheet("AuditLog");
    sh.appendRow([
      "timestamp",
      "type",
      "user",
      "userId",
      "role",
      "detail",
      "device",
      "status",
    ]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 8)
      .setBackground("#1e293b")
      .setFontColor("#ffffff")
      .setFontWeight("bold");
    sh.setColumnWidth(1, 160);
    sh.setColumnWidth(4, 200);
    sh.setColumnWidth(6, 350);
  }
  // บังคับ column A ทั้งหมดเป็น plain text เพื่อป้องกัน Sheet แปลง DD/MM/YY เป็น Date
  sh.getRange(1, 1, Math.max(sh.getMaxRows(), 1000), 1).setNumberFormat(
    "@STRING@",
  );
  return sh;
}

/* ============================================================
   _writeAudit() — ฟังก์ชันกลางสำหรับเขียน AuditLog จาก backend
   ใช้แทน webWriteAudit() ในส่วนที่เรียกจาก GAS โดยตรง
   (ไม่ต้องการ HTTP round-trip แบบที่ frontend ทำ)
============================================================ */
function _writeAudit(type, detail, user, userId, role, device, status) {
  try {
    const sh = _getOrCreateAuditSheet();

    const MAX_ROWS = 2000;
    const lastRow = sh.getLastRow();
    if (lastRow > MAX_ROWS) {
      sh.deleteRows(2, lastRow - MAX_ROWS);
    }

    const now = new Date();
    const tzOffset = 7 * 60 * 60 * 1000;
    const localTime = new Date(now.getTime() + tzOffset);
    const pad = (n) => String(n).padStart(2, "0");
    const d = localTime;
    const thaiYear = String(d.getUTCFullYear() + 543).slice(-2);
    const timeStr = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${thaiYear} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

    const newRow = [
      timeStr,
      type || "-",
      user || "ไม่ระบุ",
      userId || "-",
      role || "-",
      detail || "-",
      device || "LINE",
      status || "SUCCESS",
    ];

    const nextRow = sh.getLastRow() + 1;
    sh.getRange(nextRow, 1, 1, newRow.length)
      .setValues([newRow])
      .setNumberFormat("@STRING@");
  } catch (e) {
    console.error("_writeAudit error: " + e);
  }
}

function webWriteAudit(payload) {
  try {
    if (!payload || !payload.type || !payload.detail) {
      return { success: false, error: "ข้อมูลไม่ครบ" };
    }

    const sh = _getOrCreateAuditSheet();

    // จำกัดสูงสุด 2000 แถว (ลบแถวเก่าสุดออกถ้าเกิน)
    const MAX_ROWS = 2000;
    const lastRow = sh.getLastRow();
    if (lastRow > MAX_ROWS) {
      const excessRows = lastRow - MAX_ROWS;
      sh.deleteRows(2, excessRows);
    }

    const now = new Date();
    const tzOffset = 7 * 60 * 60 * 1000;
    const localTime = new Date(now.getTime() + tzOffset);
    const pad = (n) => String(n).padStart(2, "0");
    const d = localTime;
    const thaiYear = String(d.getUTCFullYear() + 543).slice(-2);
    const timeStr = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${thaiYear} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

    const newRow = [
      timeStr,
      payload.type || "-",
      payload.user || "ไม่ระบุ",
      payload.userId || "-",
      payload.role || "-",
      payload.detail || "-",
      payload.device || "Web",
      payload.status || "SUCCESS",
    ];

    // ใช้ appendRow แล้วตั้ง NumberFormat เป็น @STRING@ เพื่อป้องกัน Sheet แปลง DD/MM/YY เป็น Date object
    const nextRow = sh.getLastRow() + 1;
    sh.getRange(nextRow, 1, 1, newRow.length)
      .setValues([newRow])
      .setNumberFormat("@STRING@");

    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webGetAuditLogs(limit) {
  try {
    const sh = _getOrCreateAuditSheet();
    const maxRows = limit || 500;
    const lastRow = sh.getLastRow();
    if (lastRow <= 1) return { success: true, logs: [] };

    const startRow = Math.max(2, lastRow - maxRows + 1);
    const numRows = lastRow - startRow + 1;
    const data = sh.getRange(startRow, 1, numRows, 8).getValues();

    const pad = (n) => String(n).padStart(2, "0");
    const formatCell = (v) => {
      // ถ้าเป็น Date object จาก Google Sheet ให้แปลงเป็น DD/MM/YY HH:MM:SS
      if (v instanceof Date && !isNaN(v.getTime())) {
        const tzOffset = 7 * 60 * 60 * 1000;
        const local = new Date(v.getTime() + tzOffset);
        const thaiYear = String(local.getUTCFullYear() + 543).slice(-2);
        return `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${thaiYear} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
      }
      // ถ้าเป็น string อยู่แล้ว (บันทึกใหม่หลังแก้) ใช้ได้เลย
      return String(v || "");
    };

    const logs = data.reverse().map((r) => ({
      time: formatCell(r[0]),
      type: String(r[1] || ""),
      user: String(r[2] || ""),
      userId: String(r[3] || ""),
      role: String(r[4] || ""),
      detail: String(r[5] || ""),
      device: String(r[6] || ""),
      status: String(r[7] || "SUCCESS"),
    }));

    return { success: true, logs: logs };
  } catch (e) {
    return { success: false, error: e.toString(), logs: [] };
  }
}

function webClearAuditLog(userName) {
  try {
    const sh = _getOrCreateAuditSheet();
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 8).clearContent();
    }
    const now = new Date();
    const tzOffset = 7 * 60 * 60 * 1000;
    const localTime = new Date(now.getTime() + tzOffset);
    const pad = (n) => String(n).padStart(2, "0");
    const d = localTime;
    const thaiYear = String(d.getUTCFullYear() + 543).slice(-2);
    const timeStr = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${thaiYear} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    const nextRow = sh.getLastRow() + 1;
    sh.getRange(nextRow, 1, 1, 8)
      .setValues([
        [
          timeStr,
          "SETTINGS",
          userName || "Admin",
          "-",
          "admin",
          "ล้าง Audit Log ทั้งหมด",
          "Web",
          "SUCCESS",
        ],
      ])
      .setNumberFormat("@STRING@");
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

/**************** TEXT HANDLING ****************/
function handleText(text, userId, replyToken) {
  const user = getUser(userId);
  const settings = getSettings();

  if (!user) {
    return replyFlex(replyToken, flexWelcomeEntry(settings));
  }
  if (user.role === "pending") {
    return reply(replyToken, "⏳ บัญชีอยู่ระหว่างรออนุมัติครับ");
  }
  if (user.role === "rejected") {
    return reply(replyToken, "⛔ บัญชีถูกระงับ");
  }

  if (text === "ยกเลิก" || text === "เมนู") {
    clearSession(userId);
    if (text === "ยกเลิก") {
      return reply(replyToken, "❌ ยกเลิกรายการแล้วครับ");
    }
    return replyFlex(
      replyToken,
      flexMenu(user.role, user.name, settings, userId),
    );
  }

  if (text.startsWith("ประกาศ ")) {
    if (user.role !== "admin") {
      return reply(replyToken, "⛔ เฉพาะ Admin ครับ");
    }
    const msg = text.replace("ประกาศ ", "").trim();
    if (msg) {
      broadcastMessage(msg, user.name, settings);
      return reply(replyToken, "📢 ส่งประกาศเรียบร้อย!");
    }
  }

  if (cacheGet(userId, "newItemStep")) {
    return handleNewItemProcess(userId, replyToken, text, null);
  }
  if (text === "เบิก") {
    return setMode(userId, "เบิก", replyToken);
  }
  if (text === "ยืม") {
    return setMode(userId, "ยืม", replyToken);
  }
  if (text === "คืน") {
    clearSession(userId);
    cacheSet(userId, "mode", "คืน");
    return sendActiveBorrows(userId, replyToken);
  }
  if (text === "รับเข้า") {
    if (user.role === "admin") {
      return setMode(userId, "รับเข้า", replyToken);
    }
    return reply(replyToken, "⛔ เฉพาะ Admin ครับ");
  }
  if (text === "ปรับยอด") {
    if (user.role === "admin") {
      return setMode(userId, "ปรับยอด", replyToken);
    }
    return reply(replyToken, "⛔ เฉพาะ Admin ครับ");
  }

  if (text === "ประวัติ") {
    return replyFlex(replyToken, flexHistoryTypeSelection(settings));
  }
  if (text === "ประวัติสต็อก") {
    return sendHistory(replyToken, "Stock");
  }
  if (text === "ประวัติเครื่องมือ") {
    return sendHistory(replyToken, "Tools");
  }
  if (text === "ดูสต็อก") {
    return sendDashboardFlex(replyToken, userId, settings);
  }

  if (text.startsWith("ค้นหา")) {
    const kw = text.replace("ค้นหา", "").trim();
    if (kw) {
      return searchItem(kw, replyToken, settings);
    }
    return reply(replyToken, "🔍 พิมพ์: ค้นหา [ชื่อสินค้า]");
  }

  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const qty = Number(text);
    const mode = cacheGet(userId, "mode") || "เบิก";

    if (mode !== "ปรับยอด" && qty <= 0) {
      return reply(replyToken, "❌ จำนวนต้องมากกว่า 0 ครับ");
    }
    if (mode === "ปรับยอด" && qty === 0) {
      return reply(replyToken, "❌ จำนวนห้ามเป็น 0");
    }

    const rawItem = cacheGet(userId, "item");
    if (!rawItem) {
      return reply(replyToken, "❌ กรุณาเลือกสินค้าก่อนครับ");
    }
    const info = getItemInfo(rawItem, getPreferredSheet(mode));
    if (!info.code) {
      return reply(replyToken, "❌ ไม่พบข้อมูล: " + rawItem);
    }

    if (getSheetNameByMode(mode) !== info.sheet) {
      return reply(
        replyToken,
        `⛔ เลือกหมวดผิด กรุณาใช้เมนูให้ตรงกับประเภทของครับ`,
      );
    }

    if (
      (mode === "เบิก" || mode === "ยืม" || mode === "แจ้งชำรุด") &&
      qty > info.stock
    ) {
      return reply(replyToken, `❌ ของไม่พอครับ (มี: ${info.stock})`);
    }

    cacheSet(userId, "qty", qty);
    if (mode === "ปรับยอด") {
      return replyFlex(
        replyToken,
        flexConfirm(
          {
            mode: mode,
            machine: info.category,
            itemName: info.name,
            itemCode: info.code,
            qty: qty,
          },
          settings,
        ),
      );
    }
    return reply(
      replyToken,
      `📸 ขั้นตอนสุดท้าย: ถ่ายรูปยืนยันการ${mode}\n(📦 ${info.name} จำนวน ${qty} ${info.unit})\nส่งรูปในแชทได้เลยครับ`,
    );
  }

  // ── SCAN QR Fast Track ──
  // QR ฝัง URL: line://oaMessage/BOTID/?text=SCAN:BL-029
  // เมื่อพนักงานสแกน QR → LINE ส่งข้อความ "SCAN:BL-029" เข้ามา
  if (text.startsWith("SCAN:")) {
    const scanCode = text.replace("SCAN:", "").trim();
    const scanInfo = getItemInfo(scanCode) || getItemInfo(scanCode, "Tools");
    if (!scanInfo || !scanInfo.code) {
      return reply(
        replyToken,
        `⚠️ ไม่พบรหัสสินค้า: ${scanCode}\nกรุณาตรวจสอบ QR Code ครับ`,
      );
    }

    // เก็บ session ว่ากำลังจะเบิกอะไร
    clearSession(userId);
    cacheSet(userId, "item", scanInfo.code);
    cacheSet(userId, "mode", "เบิก");
    cacheSet(userId, "scan_fast", "1");

    const stockText =
      scanInfo.stock > 0
        ? `คงเหลือ ${scanInfo.stock} ${scanInfo.unit || "ชิ้น"}`
        : "⚠️ สต็อกหมด";

    // ส่ง Flex พร้อม Quick Reply ปุ่มตัวเลข
    return replyFlex(replyToken, flexScanConfirm(scanInfo, settings));
  }

  // รับจำนวนจาก Quick Reply หลัง SCAN
  if (cacheGet(userId, "scan_fast") === "1") {
    const scanQty = parseInt(text);
    if (!isNaN(scanQty) && scanQty > 0) {
      const scanCode = cacheGet(userId, "item");
      const scanInfo = getItemInfo(scanCode) || getItemInfo(scanCode, "Tools");
      if (scanInfo) {
        if (scanQty > scanInfo.stock) {
          return reply(
            replyToken,
            `⚠️ สต็อกมีแค่ ${scanInfo.stock} ${scanInfo.unit || "ชิ้น"}\nกรุณาระบุจำนวนใหม่ครับ`,
          );
        }
        // เบิกได้เลย ไม่ต้องถ่ายรูป
        // ⚠️ updateStock mode "เบิก" จะลบออกเองใน isMinus logic — ห้ามใส่ลบซ้ำ
        updateStock(scanCode, scanQty, "เบิก", user.name);
        sheet("Logs").appendRow([
          getThaiNow(),
          scanCode,
          scanInfo.name,
          `-${scanQty}`,
          scanInfo.stock - scanQty,
          "LINE-QR",
          "เบิก",
          user.name,
          "QR Fast Track",
        ]);
        _writeAudit(
          "เบิก",
          `[QR] [${scanCode}] ${scanInfo.name} จำนวน ${scanQty}`,
          user.name,
          userId,
          user.role,
          "LINE-QR",
        );
        clearSession(userId);

        return replyFlex(
          replyToken,
          flexScanSuccess(
            {
              itemName: scanInfo.name,
              itemCode: scanCode,
              qty: scanQty,
              unit: scanInfo.unit || "ชิ้น",
              remaining: scanInfo.stock - scanQty,
              userName: user.name,
            },
            settings,
          ),
        );
      }
    }
    // กรอกเลขผิด
    return reply(replyToken, "⚠️ กรุณาระบุจำนวนเป็นตัวเลขครับ\nเช่น: 1, 2, 3");
  }

  // เพิ่มการรองรับรหัสสินค้าจากการสแกน QR (แบบเดิม)
  const scannedItemInfo = getItemInfo(text);
  if (scannedItemInfo && scannedItemInfo.code) {
    const currentMode = cacheGet(userId, "mode") || "เบิก";
    cacheSet(userId, "item", scannedItemInfo.code);
    return reply(
      replyToken,
      `👉 ระบุจำนวนการ${currentMode}\n(📦 ${scannedItemInfo.name})\n[เหลือ: ${scannedItemInfo.stock} ${scannedItemInfo.unit}]`,
    );
  }

  return reply(
    replyToken,
    "❓ ไม่เข้าใจคำสั่ง พิมพ์ 'เมนู' หรือ 'ค้นหา [ชื่อ]' ครับ",
  );
}

/**************** POSTBACK HANDLING ****************/
function handlePostback(data, userId, replyToken) {
  const user = getUser(userId);
  const settings = getSettings();
  if (!user) {
    return replyFlex(replyToken, flexWelcomeEntry(settings));
  }
  if (data === "cancel") {
    clearSession(userId);
    return reply(replyToken, "❌ ยกเลิกแล้วครับ");
  }

  if (data.startsWith("approve:")) {
    const targetId = data.split(":")[1];

    // ---- ดึงข้อมูลจาก QRRegistrations ก่อน ----
    const ss = getActiveSpreadsheetInstance();
    const qrSh = ss.getSheetByName("QRRegistrations");
    let approvedFromQR = false;

    if (qrSh) {
      const qrData = qrSh.getDataRange().getValues();
      for (let i = 1; i < qrData.length; i++) {
        if (
          String(qrData[i][0]).trim() === String(targetId).trim() &&
          String(qrData[i][5]).trim() === "pending"
        ) {
          const qrName = qrData[i][1];
          const qrDept = qrData[i][2];
          const qrPin = qrData[i][3];
          const qrDate = qrData[i][4];

          // ย้ายเข้า Users sheet พร้อม PIN ที่ถูกต้อง
          // layout: A=userId, B=name, C=role, D=แผนก, E=PIN, F=registeredAt, H=source
          const usersSh = sheet("Users");
          const numCols = Math.max(usersSh.getLastColumn(), 8);
          const newRow = new Array(numCols).fill("");
          newRow[0] = targetId;
          newRow[1] = qrName;
          newRow[2] = "qr";
          newRow[3] = qrPin; // col D = PIN
          newRow[4] = qrDept; // col E = dept
          newRow[5] = qrDate;
          newRow[7] = "QR-Registration";
          usersSh.appendRow(newRow);

          // อัปเดตสถานะใน QRRegistrations เป็น approved
          qrSh.getRange(i + 1, 6).setValue("approved");

          _writeAudit(
            "REGISTER",
            `อนุมัติจาก QR: ${qrName} (${qrDept || "ไม่ระบุ"})`,
            "Admin",
            targetId,
            "qr",
            "LINE-Approve",
          );
          approvedFromQR = true;
          break;
        }
      }
    }

    // ถ้าไม่เจอใน QRRegistrations ให้ fallback เปลี่ยน role เป็น "qr" เหมือนกัน (บังคับเป็น qr เสมอ ไม่ให้กลายเป็น user อีก)
    if (!approvedFromQR) {
      updateUserRole(targetId, "qr");
    }

    push(targetId, [
      { type: "text", text: "✅ บัญชีอนุมัติแล้ว! พิมพ์ 'เมนู' ได้เลย" },
    ]);
    return reply(replyToken, "✅ อนุมัติผู้ใช้เรียบร้อย");
  }
  if (data.startsWith("reject:")) {
    const targetId = data.split(":")[1];

    // ---- อัปเดตสถานะใน QRRegistrations ----
    const ss2 = getActiveSpreadsheetInstance();
    const qrSh2 = ss2.getSheetByName("QRRegistrations");
    let rejectedFromQR = false;

    if (qrSh2) {
      const qrData2 = qrSh2.getDataRange().getValues();
      for (let i = 1; i < qrData2.length; i++) {
        if (
          String(qrData2[i][0]).trim() === String(targetId).trim() &&
          String(qrData2[i][5]).trim() === "pending"
        ) {
          qrSh2.getRange(i + 1, 6).setValue("rejected");
          rejectedFromQR = true;
          break;
        }
      }
    }

    // fallback: ถ้าเป็นการสมัครผ่าน LINE ให้เปลี่ยน role ใน Users เหมือนเดิม
    if (!rejectedFromQR) {
      updateUserRole(targetId, "rejected");
    }

    push(targetId, [{ type: "text", text: "❌ คำขอถูกปฏิเสธ" }]);
    return reply(replyToken, "❌ ปฏิเสธเรียบร้อย");
  }

  if (data.startsWith("machine:")) {
    const cat = data.split(":")[1];
    cacheSet(userId, "machine", cat);
    const flex = flexItems(cat, userId, settings);
    if (flex) {
      return replyFlex(replyToken, flex);
    }
    return reply(replyToken, "❌ ไม่พบสินค้า");
  }

  if (data.startsWith("item:")) {
    const parts = data.split(":");
    cacheSet(userId, "item", parts[1]);
    const info = getItemInfo(parts[1], parts[2]);
    const currentMode = cacheGet(userId, "mode") || "เบิก";
    return reply(
      replyToken,
      `👉 ระบุจำนวนการ${currentMode}\n(📦 ${info.name})\n[เหลือ: ${info.stock} ${info.unit}]`,
    );
  }

  if (data.startsWith("confirm|")) {
    const p = data.split("|");
    const itemCode = p[1];
    const qty = Number(p[2]);
    const action = p[3];
    if (action === "เบิก") {
      return submitWithdraw(userId, replyToken, itemCode, qty, settings);
    }
    if (action === "รับเข้า") {
      return submitReceive(userId, replyToken, itemCode, qty, settings);
    }
    if (action === "ยืม") {
      return submitBorrow(userId, replyToken, itemCode, qty, settings);
    }
    if (action === "คืน") {
      return submitReturn(userId, replyToken, itemCode, qty, settings);
    }
    if (action === "ปรับยอด") {
      return submitAdjust(userId, replyToken, itemCode, qty, settings);
    }
  }

  if (data.startsWith("borrow_approve:")) {
    return approveBorrowRequest(data.split(":")[1], userId, replyToken);
  }
  if (data.startsWith("borrow_reject:")) {
    return rejectBorrowRequest(data.split(":")[1], userId, replyToken);
  }

  if (data.startsWith("webtx_approve:")) {
    return approveWebPendingRequest(data.split(":")[1], userId, replyToken);
  }

  if (data.startsWith("webtx_reject:")) {
    return rejectWebPendingRequest(data.split(":")[1], userId, replyToken);
  }
  if (data.startsWith("return_select:")) {
    const reqId = data.split(":")[1];
    const borrowData = getBorrowRequestById(reqId);
    if (!borrowData) {
      return reply(replyToken, "❌ ไม่พบรายการ");
    }
    cacheSet(userId, "return_req_id", reqId);
    cacheSet(userId, "item", borrowData.itemCode);
    cacheSet(userId, "qty", borrowData.qty);
    cacheSet(userId, "mode", "คืน");
    return reply(
      replyToken,
      `📸 ถ่ายรูปยืนยันการคืน\n(🛠️ ${borrowData.itemName} จำนวน ${borrowData.qty})`,
    );
  }

  if (data === "new_item_start") {
    if (user.role !== "admin") {
      return reply(replyToken, "⛔ เฉพาะ Admin");
    }
    clearSession(userId);
    return replyFlex(replyToken, flexTypeSelectionForNewItem(settings));
  }
  if (data.startsWith("new_item_type:")) {
    const type = data.split(":")[1];
    cacheSet(userId, "newItemType", type);
    return replyFlex(replyToken, flexCategoryForNewItem(type, settings));
  }
  if (data.startsWith("new_item_cat:")) {
    const cat = data.split(":")[1];
    const type = cacheGet(userId, "newItemType") || "Items";
    const code = getNextItemCode(cat, type, settings);
    cacheSet(
      userId,
      "newItemData",
      JSON.stringify({ category: cat, code: code }),
    );
    cacheSet(userId, "newItemStep", "1");
    return reply(
      replyToken,
      `✨ เพิ่มของหมวด: ${cat}\n🔖 รหัส: ${code}\n\nStep 1/5: พิมพ์ **ชื่อสินค้า**:`,
    );
  }
  if (data === "new_item_confirm") {
    return submitNewItem(userId, replyToken, settings);
  }
}

/**************** HELPER FUNCTIONS ****************/
function getSheetNameByMode(mode) {
  if (mode === "ยืม" || mode === "คืน") {
    return "Tools";
  }
  return "Items";
}

function getPreferredSheet(mode) {
  if (mode === "ยืม" || mode === "คืน") {
    return "Tools";
  }
  if (
    mode === "เบิก" ||
    mode === "รับเข้า" ||
    mode === "แจ้งชำรุด" ||
    mode === "ซ่อมแซมแล้ว"
  ) {
    return "Items";
  }
  return null;
}

function formatDate(dateObj) {
  if (!dateObj) {
    return "-";
  }
  try {
    const d = new Date(dateObj);
    if (isNaN(d.getTime())) return String(dateObj); // กรณีที่ Sheet ส่งข้อมูลมาแปลกๆ ให้ return ค่าเดิม
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = String(d.getFullYear() + 543).slice(-2);
    const hours = String(d.getHours()).padStart(2, "0");
    const mins = String(d.getMinutes()).padStart(2, "0");
    return `${day}/${month}/${year} ${hours}:${mins}`;
  } catch (e) {
    return String(dateObj);
  }
}

function broadcastMessage(message, senderName, settings) {
  const allUsers = sheet("Users").getDataRange().getValues().slice(1);
  const activeUsers = allUsers.filter(
    (r) => r[2] === "user" || r[2] === "admin",
  );
  const tColor = settings.themeColor || THEME_COLOR;
  const flex = {
    type: "flex",
    altText: "📢 ประกาศจาก Admin",
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "📢 ประกาศจาก Admin",
            weight: "bold",
            color: "#FFFFFF",
          },
        ],
        backgroundColor: tColor,
        paddingAll: "md",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: message, wrap: true },
          {
            type: "text",
            text: "จาก: " + senderName,
            size: "xs",
            color: "#aaaaaa",
            margin: "md",
          },
        ],
      },
    },
  };
  for (let i = 0; i < activeUsers.length; i++) {
    const u = activeUsers[i];
    try {
      push(u[0], [flex]);
    } catch (e) {
      // Ignore specific user error
    }
  }
}

// [DEPRECATED] LINE Notify ถูก LINE ปิดให้บริการถาวรตั้งแต่ปี 2025 ฟังก์ชันนี้เก็บไว้เฉยๆ ไม่ถูกเรียกใช้แล้ว
function sendLineNotify(message, token) {
  if (!token || token === "") return;
  try {
    UrlFetchApp.fetch("https://notify-api.line.me/api/notify", {
      method: "post",
      headers: { Authorization: "Bearer " + token },
      payload: { message: message },
    });
  } catch (e) {
    // Ignore notify error
  }
}

function webReportFailedLoginAttempt(userId, failedCount) {
  try {
    const users = sheet("Users").getDataRange().getValues();
    let userName = "ไม่ทราบชื่อ";
    for (let i = 1; i < users.length; i++) {
      if (users[i][0] === userId) {
        userName = users[i][1];
        break;
      }
    }
    const timestamp = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
    const alertMsg = `🚨 แจ้งเตือนความปลอดภัย!\nมีการพยายามเข้าสู่ระบบด้วย PIN ผิดพลาดสำหรับผู้ใช้: [${userId}] ${userName} จำนวน ${failedCount} ครั้งติดต่อกัน\nเมื่อเวลา: ${timestamp}`;
    notifyAdminsText(alertMsg);
  } catch (e) {
    // Ignore notify error
  }
  return { success: true };
}

// ส่งข้อความแจ้งเตือนถึงแอดมินทุกคน ผ่านบอท LINE โดยตรง (แทนที่ LINE Notify ที่เลิกให้บริการแล้ว)
function notifyAdminsText(message) {
  try {
    const admins = sheet("Users")
      .getDataRange()
      .getValues()
      .slice(1)
      .filter((r) => r[2] === "admin");
    admins.forEach((a) => {
      try {
        push(a[0], [{ type: "text", text: message }]);
      } catch (e) {
        /* ข้าม admin คนที่ push ไม่สำเร็จ */
      }
    });
  } catch (e) {
    // Ignore notify error
  }
}

/**************** CORE LOGIC FUNCTIONS ****************/
function setMode(userId, mode, replyToken) {
  clearSession(userId);
  cacheSet(userId, "mode", mode);
  const settings = getSettings();
  const flex = flexMachine(mode, settings);
  return replyFlex(replyToken, flex);
}

function submitWithdraw(userId, replyToken, itemCode, qty, settings) {
  const imageUrl = cacheGet(userId, "image");
  if (!imageUrl) {
    return reply(replyToken, "⛔ กรุณาถ่ายรูปก่อนครับ");
  }
  try {
    const user = getUser(userId);
    updateStock(itemCode, qty, "เบิก", user.name);
    const info = getItemInfo(itemCode, "Items");
    const rowData = [
      "WD" + Date.now(),
      getThaiNow(),
      userId,
      user.name,
      itemCode,
      info.name,
      qty,
      info.category,
      imageUrl,
    ];
    sheet("Requests").appendRow(rowData);
    sheet("Withdraws").appendRow(rowData);
    clearItemData(userId);
    const replyMessages = [
      {
        type: "text",
        text: `✅ บันทึกเบิกเรียบร้อย!\n📦 ${info.name}\nจำนวน: ${qty} ${info.unit}`,
      },
      flexMenu(user.role, user.name, settings, userId),
    ];
    send(replyToken, replyMessages);
  } catch (e) {
    reply(replyToken, "❌ Error: " + e);
  }
}

function submitReceive(userId, replyToken, itemCode, qty, settings) {
  const imageUrl = cacheGet(userId, "image");
  if (!imageUrl) {
    return reply(replyToken, "⛔ ถ่ายรูปก่อนครับ");
  }
  const user = getUser(userId);
  updateStock(itemCode, qty, "รับเข้า", user.name);
  const info = getItemInfo(itemCode, "Items");
  sheet("Receives").appendRow([
    "RC" + Date.now(),
    getThaiNow(),
    userId,
    user.name,
    "รับเข้า",
    itemCode,
    info.name,
    qty,
    info.category,
    imageUrl,
    "approved",
  ]);
  clearItemData(userId);
  const replyMessages = [
    {
      type: "text",
      text: `✅ รับเข้าเรียบร้อย!\n📦 ${info.name}\nจำนวน: ${qty} ${info.unit}`,
    },
    flexMenu(user.role, user.name, settings, userId),
  ];
  send(replyToken, replyMessages);
}

function submitAdjust(userId, replyToken, itemCode, qty, settings) {
  const user = getUser(userId);
  const infoB = getItemInfo(itemCode);
  updateStock(itemCode, qty, "ปรับยอด", user.name);
  const infoA = getItemInfo(itemCode);
  sheet("AdjustLogs").appendRow([
    "AD" + Date.now(),
    getThaiNow(),
    userId,
    user.name,
    itemCode,
    infoB.name,
    qty,
    infoB.sheet,
  ]);
  clearItemData(userId);
  const sign = qty > 0 ? "+" : "";
  const replyMessages = [
    {
      type: "text",
      text: `✅ ปรับยอดเรียบร้อย!\n📦 ${infoB.name}\nปรับ: ${sign}${qty}\nคงเหลือใหม่: ${infoA.stock}`,
    },
    flexMenu(user.role, user.name, settings, userId),
  ];
  send(replyToken, replyMessages);
}

function submitBorrow(userId, replyToken, itemCode, qty, settings) {
  const img = cacheGet(userId, "image");
  if (!img) {
    return reply(replyToken, "⛔ ถ่ายรูปก่อนครับ");
  }
  const reqId = "BR" + Date.now();
  const user = getUser(userId);
  const info = getItemInfo(itemCode, "Tools");
  if (settings.autoApprove) {
    updateStock(itemCode, qty, "ยืม", user.name);
    sheet("BorrowRequests").appendRow([
      reqId,
      new Date(),
      userId,
      user.name,
      itemCode,
      info.name,
      qty,
      info.category,
      img,
      "approved",
      new Date(),
      "ยืมอัตโนมัติ",
    ]);
    clearItemData(userId);
    send(replyToken, [
      {
        type: "text",
        text: `✅ ยืมสำเร็จ! (อนุมัติอัตโนมัติ)\n📦 ${info.name}`,
      },
      flexMenu(user.role, user.name, settings, userId),
    ]);
    notifyAdminsText(
      `✅ มีการยืมสินค้า (อนุมัติอัตโนมัติ)\nผู้ยืม: ${user.name}\nรายการ: ${info.name}\nจำนวน: ${qty}`,
    );
  } else {
    sheet("BorrowRequests").appendRow([
      reqId,
      new Date(),
      userId,
      user.name,
      itemCode,
      info.name,
      qty,
      info.category,
      img,
      "pending",
    ]);
    clearItemData(userId);
    reply(replyToken, "⏳ ส่งคำขอยืม รออนุมัติครับ");
    const tColor = settings.themeColor || THEME_COLOR;
    const flex = {
      type: "flex",
      altText: "คำขอยืม",
      contents: {
        type: "bubble",
        header: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: "🛠️ คำขอยืมเครื่องมือ",
              weight: "bold",
              color: "#FFFFFF",
            },
          ],
          backgroundColor: "#E67E22",
          paddingAll: "md",
        },
        hero: {
          type: "image",
          url: img,
          size: "full",
          aspectRatio: "20:13",
          aspectMode: "cover",
        },
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: `${user.name} ขอขอยืม ${info.name} (${qty} ${info.unit})`,
            },
          ],
        },
        footer: {
          type: "box",
          layout: "horizontal",
          spacing: "md",
          contents: [
            {
              type: "button",
              action: {
                type: "postback",
                label: "❌ ปฏิเสธ",
                data: "borrow_reject:" + reqId,
                displayText: "❌ ปฏิเสธการยืม",
              },
              style: "secondary",
              color: COLOR_DANGER,
            },
            {
              type: "button",
              action: {
                type: "postback",
                label: "✅ อนุมัติ",
                data: "borrow_approve:" + reqId,
                displayText: "✅ อนุมัติการยืม",
              },
              style: "primary",
              color: COLOR_SUCCESS,
            },
          ],
        },
      },
    };
    const allUsers = sheet("Users").getDataRange().getValues().slice(1);
    const admins = allUsers.filter((r) => r[2] === "admin");
    _pushApprovalToAdmins(admins, [flex]);
  }
}

// ส่ง flex การ์ด "รออนุมัติ" (มีปุ่มอนุมัติ/ปฏิเสธ) ให้แอดมินทุกคน
// ถ้าแอดมินคนไหนมี LINE สำรอง (คอลัมน์ J = lineId2 ในชีต Users) ก็จะส่งซ้ำไปไลน์สำรองด้วย
// เฉพาะจุดนี้เท่านั้นที่ใช้ TOKEN2 — ใช้แค่ให้แอดมินกดอนุมัติได้จากไลน์สำรอง ไม่เกี่ยวกับ user ทั่วไป
function _pushApprovalToAdmins(admins, msgs) {
  for (let i = 0; i < admins.length; i++) {
    const a = admins[i];
    let bot1Success = false;
    try {
      const res = push(a[0], msgs);
      if (res && res.getResponseCode() === 200) {
        bot1Success = true;
      } else {
        const errMsg = "รหัสตอบกลับ: " + (res ? res.getResponseCode() : "ไม่มีการตอบกลับ") + " | " + (res ? res.getContentText() : "");
        console.error("❌ บอท 1 ส่งไม่สำเร็จ " + errMsg);
        _writeAudit("LINE_PUSH_FAIL", "บอทหลักส่งแจ้งเตือนไม่สำเร็จ ถึง " + (a[1] || a[0]) + " — " + errMsg, a[1] || "-", a[0], "system", "Server-LINE");
      }
    } catch (e) {
      console.error("❌ บอท 1 เกิดข้อผิดพลาด: " + e.toString());
      _writeAudit("LINE_PUSH_FAIL", "บอทหลักเกิดข้อผิดพลาด ถึง " + (a[1] || a[0]) + " — " + e.toString(), a[1] || "-", a[0], "system", "Server-LINE");
    }

    const lineId2 = a[9] ? String(a[9]).trim() : "";
    if (lineId2 && TOKEN2) {
      try {
        let finalMsgs = msgs;
        if (!bot1Success && isNotifyFallbackEnabled()) {
          finalMsgs = [
            { 
              type: "text", 
              text: getNotifyFallbackMsg()
            }
          ].concat(msgs);
        }
        const res2 = push(lineId2, finalMsgs, TOKEN2);
        if (res2 && res2.getResponseCode() !== 200) {
          const errMsg2 = "รหัสตอบกลับ: " + res2.getResponseCode() + " | " + res2.getContentText();
          console.error("❌ บอท 2 ส่งไม่สำเร็จ " + errMsg2);
          _writeAudit("LINE_PUSH_FAIL", "บอทสำรองส่งแจ้งเตือนไม่สำเร็จ ถึง " + (a[1] || lineId2) + " — " + errMsg2, a[1] || "-", lineId2, "system", "Server-LINE");
        } else {
          console.log("✅ บอท 2 ส่งสำเร็จ!");
        }
      } catch (e) {
        console.error("❌ บอท 2 เกิดข้อผิดพลาด: " + e.toString());
        _writeAudit("LINE_PUSH_FAIL", "บอทสำรองเกิดข้อผิดพลาด ถึง " + (a[1] || lineId2) + " — " + e.toString(), a[1] || "-", lineId2, "system", "Server-LINE");
      }
    } else if (!lineId2) {
      console.log("⏭️ ข้าม: ไม่มีการส่งบอทสำรองให้ " + (a[1] || a[0]) + " เพราะคอลัมน์ lineId2 ว่างเปล่า");
    } else if (!TOKEN2) {
      console.log("⏭️ ข้าม: ไม่มีการส่งบอทสำรอง เพราะไม่ได้ตั้งค่า TOKEN2 ใน Script Properties");
    }
  }
}

function _normalizeApprovalPayload(payload) {
  if (!payload)
    return {
      reqId: "",
      adminUid: "",
      adminName: "",
      replyToken: "",
      remark: "",
    };
  if (typeof payload === "string") {
    return {
      reqId: payload,
      adminUid: arguments[1] || arguments[0],
      adminName: "",
      replyToken: "",
      remark: "",
    };
  }
  return {
    reqId: payload.reqId || payload.id || payload.requestId || "",
    adminUid:
      payload.adminUid ||
      payload.userId ||
      payload.actorUserId ||
      payload.adminId ||
      "",
    adminName: payload.adminName || payload.admin || "",
    replyToken: payload.replyToken || "",
    remark: payload.remark || "",
  };
}

function webApproveBorrow(payload) {
  const normalized = _normalizeApprovalPayload(payload);
  const reqId = normalized.reqId;
  const adminUid = normalized.adminUid;
  if (!reqId) return { success: false, error: "ไม่พบ reqId" };

  try {
    const sheetRows = sheet("WebPendingRequests").getDataRange().getValues();
    const hasWebPending = sheetRows.some(
      (row, idx) => idx > 0 && String(row[0]).trim() === String(reqId).trim(),
    );
    if (hasWebPending) {
      return webApprovePendingRequest({ ...normalized, reqId, adminUid });
    }
  } catch (e) {
    // ignore and fall back to borrow request flow
  }

  return approveBorrowRequest(reqId, adminUid, normalized.replyToken, {
    ...normalized,
    reqId,
    adminUid,
  });
}

function webRejectBorrow(payload) {
  const normalized = _normalizeApprovalPayload(payload);
  const reqId = normalized.reqId;
  const adminUid = normalized.adminUid;
  if (!reqId) return { success: false, error: "ไม่พบ reqId" };

  try {
    const sheetRows = sheet("WebPendingRequests").getDataRange().getValues();
    const hasWebPending = sheetRows.some(
      (row, idx) => idx > 0 && String(row[0]).trim() === String(reqId).trim(),
    );
    if (hasWebPending) {
      return webRejectPendingRequest({ ...normalized, reqId, adminUid });
    }
  } catch (e) {
    // ignore and fall back to borrow request flow
  }

  return rejectBorrowRequest(reqId, adminUid, normalized.replyToken, {
    ...normalized,
    reqId,
    adminUid,
  });
}

function webApproveRequest(payload) {
  return webApproveBorrow(payload);
}

function webRejectRequest(payload) {
  return webRejectBorrow(payload);
}

function approveBorrowRequest(reqId, adminId, replyToken, payload) {
  payload = payload || {};
  const auth = _requireRole(adminId, ["admin"]);
  if (!auth.ok) {
    if (replyToken) return reply(replyToken, auth.error);
    return { success: false, error: auth.error };
  }

  const sh = sheet("BorrowRequests");
  const rows = sh.getDataRange().getValues();
  const idx = rows.findIndex((r) => String(r[0]) === String(reqId));
  if (idx < 0) {
    if (replyToken) return reply(replyToken, "❌ ไม่พบ");
    return { success: false, error: "ไม่พบคำขอนี้" };
  }
  if (String(rows[idx][9]).trim() !== "pending") {
    if (replyToken) return reply(replyToken, "⚠️ ไม่ได้รออนุมัติ");
    return { success: false, error: "รายการนี้ถูกดำเนินการไปแล้ว" };
  }
  try {
    const itemCode = rows[idx][4];
    const qty = Number(rows[idx][6]);
    const borrowerName = getUser(rows[idx][2])
      ? getUser(rows[idx][2]).name
      : rows[idx][3] || "ผู้ยืม";
    updateStock(itemCode, qty, "ยืม", borrowerName, payload.remark || "");
  } catch (e) {
    if (replyToken) return reply(replyToken, "❌ ตัดสต็อกไม่สำเร็จ: " + e);
    return { success: false, error: "ตัดสต็อกไม่สำเร็จ: " + e };
  }
  sh.getRange(idx + 1, 10).setValue("approved");
  sh.getRange(idx + 1, 11).setValue(getThaiNow());
  const pushMsg = [
    { type: "text", text: `✅ อนุมัติยืม ${rows[idx][5]} แล้ว` },
  ];
  try {
    push(rows[idx][2], pushMsg);
  } catch (e) {}
  _writeAudit(
    "APPROVE_BORROW",
    `อนุมัติยืม ${rows[idx][5]} x${rows[idx][6]} (${rows[idx][4]})`,
    payload.adminName || (getUser(adminId) ? getUser(adminId).name : "Admin"),
    adminId || rows[idx][2],
    "admin",
    "LINE/Web",
  );
  if (replyToken)
    return reply(replyToken, "✅ อนุมัติเรียบร้อย และตัดสต็อกสำเร็จแล้ว");
  return { success: true, message: "อนุมัติเรียบร้อย และตัดสต็อกสำเร็จแล้ว" };
}

function rejectBorrowRequest(reqId, adminId, replyToken, payload) {
  payload = payload || {};
  const auth = _requireRole(adminId, ["admin"]);
  if (!auth.ok) {
    if (replyToken) return reply(replyToken, auth.error);
    return { success: false, error: auth.error };
  }
  const sh = sheet("BorrowRequests");
  const rows = sh.getDataRange().getValues();
  const idx = rows.findIndex((r) => String(r[0]) === reqId);
  if (idx < 0) {
    return reply(replyToken, "❌ ไม่พบ");
  }
  sh.getRange(idx + 1, 10).setValue("rejected");
  sh.getRange(idx + 1, 11).setValue(getThaiNow());
  const pushMsg = [
    { type: "text", text: `❌ คำขอยืม ${rows[idx][5]} ถูกปฏิเสธ` },
  ];
  push(rows[idx][2], pushMsg);
  return reply(replyToken, "❌ ปฏิเสธเรียบร้อย");
}

// อนุมัติคำขอ เบิก/ยืม ที่ส่งมาจากหน้าเว็บ — ตอนกดอนุมัตินี่แหละคือจุดที่ตัดสต็อกจริง
function approveWebPendingRequest(reqId, adminId, replyToken) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return reply(
      replyToken,
      "⏳ ระบบกำลังประมวลผลรายการอื่นอยู่ กรุณาลองกดอนุมัติใหม่อีกครั้งครับ",
    );
  }
  try {
    ensureSignatureColumns();
    const sh = sheet("WebPendingRequests");
    const rows = sh.getDataRange().getValues();
    const idx = rows.findIndex((r) => String(r[0]) === reqId);

    if (idx < 0)
      return reply(replyToken, "❌ ไม่พบคำขอนี้ (อาจถูกลบหรือหมดอายุ)");
    if (String(rows[idx][11]) !== "pending")
      return reply(replyToken, "⚠️ รายการนี้ถูกดำเนินการไปแล้ว");

    const uid = rows[idx][2];
    const userName = rows[idx][3];
    const itemCode = rows[idx][4];
    const itemName = rows[idx][5];
    const qty = Number(rows[idx][6]);
    const category = rows[idx][7];
    const type = rows[idx][9]; // "เบิก" หรือ "ยืม"
    const remark = rows[idx][10] || "";
    const admin = getUser(adminId);
    const adminName = admin ? admin.name : "Admin";
    // เวลาที่ผู้ใช้ "ยื่นคำขอ" จริง (ไม่ใช่เวลาที่แอดมินกดอนุมัติ) — ใช้บันทึกเป็นวันที่ของ transaction/Logs
    const requestedAt = rows[idx][1] instanceof Date ? rows[idx][1] : new Date(rows[idx][1]);

    try {
      updateStock(itemCode, qty, type, userName, remark, requestedAt);
    } catch (e) {
      return reply(replyToken, "❌ ตัดสต็อกไม่สำเร็จ: " + e);
    }

    const signatureUrl = rows[idx].length > 14 ? rows[idx][14] : ""; // ดึงลิงก์ลายเซ็น

    const approvedAt = getThaiNow();
    sh.getRange(idx + 1, 12).setValue("approved");
    sh.getRange(idx + 1, 13).setValue(approvedAt);
    sh.getRange(idx + 1, 14).setValue(adminName);

    const transId = (type === "ยืม" ? "BW" : "WD") + Date.now();
    if (type === "ยืม") {
      // บันทึกลง BorrowRequests ด้วย เพื่อให้เข้าสู่ระบบ "คืน" เดิมได้ตามปกติ
      sheet("BorrowRequests").appendRow([
        transId,
        requestedAt,
        uid,
        userName,
        itemCode,
        itemName,
        qty,
        category || "-",
        "Web Scanner",
        "approved",
        approvedAt,
        remark,
        signatureUrl, // คอลัมน์ที่ 13 (index 12)
      ]);
    } else {
      sheet("Requests").appendRow([
        transId,
        requestedAt,
        uid,
        userName,
        itemCode,
        itemName,
        qty,
        category,
        "Web Scanner",
        signatureUrl, // คอลัมน์ที่ 10 (index 9)
      ]);
      try {
        sheet("Withdraws").appendRow([
          transId,
          requestedAt,
          uid,
          userName,
          itemCode,
          itemName,
          qty,
          category,
          "", // คอลัมน์ที่ 9 (index 8) = Image เว้นว่างไว้ตามโครงสร้างชีตเดิม
          signatureUrl, // คอลัมน์ที่ 10 (index 9) = SignatureUrl
          remark, // คอลัมน์ที่ 11 (index 10) = หมายเหตุ
        ]);
      } catch (e) {}
    }

    try {
      push(uid, [
        {
          type: "text",
          text: `✅ คำขอ${type} "${itemName}" จำนวน ${qty} ได้รับการอนุมัติแล้วครับ\nตัดสต็อกสำเร็จแล้ว`,
        },
      ]);
    } catch (e) {}
    try {
      notifyAdminsText(
        `✅ อนุมัติ${type} "${itemName}" x${qty} เรียบร้อยแล้ว\nผู้ขอ: ${userName}\nอนุมัติโดย: ${adminName}`,
      );
    } catch (e) {}
    return reply(
      replyToken,
      `✅ อนุมัติ${type} ${itemName} (${qty}) เรียบร้อย และตัดสต็อกสำเร็จแล้ว`,
    );
  } finally {
    lock.releaseLock();
  }
}

// ปฏิเสธคำขอ เบิก/ยืม ที่ส่งมาจากหน้าเว็บ — ไม่มีการตัดสต็อกใดๆ (ของที่กันไว้จะถูกปล่อยคืนทันที)
function rejectWebPendingRequest(reqId, adminId, replyToken) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return reply(
      replyToken,
      "⏳ ระบบกำลังประมวลผลรายการอื่นอยู่ กรุณาลองกดปฏิเสธใหม่อีกครั้งครับ",
    );
  }
  try {
    const sh = sheet("WebPendingRequests");
    const rows = sh.getDataRange().getValues();
    const idx = rows.findIndex((r) => String(r[0]) === reqId);

    if (idx < 0)
      return reply(replyToken, "❌ ไม่พบคำขอนี้ (อาจถูกลบหรือหมดอายุ)");
    if (String(rows[idx][11]) !== "pending")
      return reply(replyToken, "⚠️ รายการนี้ถูกดำเนินการไปแล้ว");

    const uid = rows[idx][2];
    const itemName = rows[idx][5];
    const qty = rows[idx][6];
    const type = rows[idx][9];
    const admin = getUser(adminId);
    const adminName = admin ? admin.name : "Admin";

    const rejectedAt = getThaiNow();
    sh.getRange(idx + 1, 12).setValue("rejected");
    sh.getRange(idx + 1, 13).setValue(rejectedAt);
    sh.getRange(idx + 1, 14).setValue(adminName);

    try {
      push(uid, [
        {
          type: "text",
          text: `❌ คำขอ${type} "${itemName}" จำนวน ${qty} ถูกปฏิเสธครับ`,
        },
      ]);
    } catch (e) {}
    try {
      notifyAdminsText(
        `❌ ปฏิเสธ${type} "${itemName}" x${qty} เรียบร้อยแล้ว\nปฏิเสธโดย: ${adminName}`,
      );
    } catch (e) {}
    return reply(replyToken, `❌ ปฏิเสธ${type} ${itemName} เรียบร้อย`);
  } finally {
    lock.releaseLock();
  }
}

// ═══════════════════════════════════════════════════
//  รายการเบิก/ยืมรออนุมัติ — สำหรับหน้าแดชบอร์ด (นอกเหนือจากปุ่มในไลน์)
// ═══════════════════════════════════════════════════

// ดึงรายการที่ยังรออนุมัติทั้งหมด (เรียกจากหน้าแดชบอร์ดที่ล็อกไว้เฉพาะ admin อยู่แล้ว)
function webGetPendingWebRequests() {
  try {
    const ss = getActiveSpreadsheetInstance();

    // ดึง imageUrl จาก Items และ Tools sheet
    const imageMap = {};
    ["Items", "Tools"].forEach(function (shName) {
      const sh = ss.getSheetByName(shName);
      if (!sh) return;
      const allRows = sh.getDataRange().getValues();
      if (allRows.length <= 1) return;
      const header = allRows[0];
      const codeIdx = header.findIndex(function (h) {
        return String(h).toLowerCase().trim() === "code";
      });
      const imgIdx = header.findIndex(function (h) {
        return String(h).toLowerCase().trim() === "imageurl";
      });
      if (codeIdx < 0 || imgIdx < 0) return;
      allRows.slice(1).forEach(function (r) {
        if (r[codeIdx])
          imageMap[String(r[codeIdx]).trim()] = String(r[imgIdx] || "");
      });
    });

    const sh = ss.getSheetByName("WebPendingRequests");
    if (!sh) {
      return {
        success: true,
        data: [],
        pendingRequests: [],
        pendingItems: [],
        count: 0,
        serverTime: formatThaiDateTime(getThaiNow()),
        items: [],
        requests: [],
        approvals: [],
      };
    }
    const rows = sh.getDataRange().getValues().slice(1);
    const list = rows
      .map((r) => ({
        reqId: r[0],
        date: r[1],
        uid: r[2],
        name: r[3],
        itemCode: r[4],
        itemName: r[5],
        qty: r[6],
        category: r[7],
        unit: r[8],
        type: r[9],
        remark: r[10],
        status: String(r[11] || "").trim(),
        imageUrl: imageMap[String(r[4]).trim()] || "",
        requestedAt: r[1] ? formatThaiDateTime(r[1]) : "",
        actionAt: r[12] ? formatThaiDateTime(r[12]) : "",
      }))
      .filter((x) => String(x.status).trim().toLowerCase() === "pending")
      .sort((a, b) => {
        const aTime =
          a.date instanceof Date
            ? a.date.getTime()
            : new Date(a.date).getTime();
        const bTime =
          b.date instanceof Date
            ? b.date.getTime()
            : new Date(b.date).getTime();
        return (isNaN(bTime) ? 0 : bTime) - (isNaN(aTime) ? 0 : aTime);
      });
    // แปลงข้อมูลเป็น Plain Object ป้องกันข้อผิดพลาดการส่งข้อมูลประเภท Date ของ google.script.run
    return JSON.parse(JSON.stringify({
      success: true,
      data: list,
      count: list.length,
      serverTime: formatThaiDateTime(getThaiNow()),
    }));
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function webGetPendingRequests() {
  return webGetPendingWebRequests();
}

function webGetPendingApprovals() {
  return webGetPendingWebRequests();
}

function getPendingWebRequests() {
  return webGetPendingWebRequests();
}

function getPendingRequests() {
  return webGetPendingWebRequests();
}

function getPendingApprovals() {
  return webGetPendingWebRequests();
}

function webApprovePendingApproval(payload) {
  return webApprovePendingRequest(payload);
}

function webRejectPendingApproval(payload) {
  return webRejectPendingRequest(payload);
}

// อนุมัติคำขอ เบิก/ยืม จากแดชบอร์ดเว็บ (ทำหน้าที่เหมือน approveWebPendingRequest แต่เรียกจากหน้าเว็บแทนปุ่มในไลน์)
// แจ้งแอดมินทุกคนทาง LINE ว่ามีการอนุมัติ/ปฏิเสธจากหน้าเว็บแล้ว (กันสับสนตอนเห็นการ์ดเก่าค้างอยู่)
// ส่งแค่ข้อความสั้นๆ ไปบอทหลักเท่านั้น (ไม่ส่งซ้ำไปบอทสำรอง เพื่อประหยัดโควต้า)
function _notifyAdminsWebAction(text) {
  try {
    const allUsers = sheet("Users").getDataRange().getValues().slice(1);
    const admins = allUsers.filter((r) => r[2] === "admin");
    for (let i = 0; i < admins.length; i++) {
      try {
        push(admins[i][0], [{ type: "text", text: text }]);
      } catch (e) {}
    }
  } catch (e) {}
}

function webApprovePendingRequest(payload) {
  payload = payload || {};
  const normalized = _normalizeApprovalPayload(payload);
  const auth = _requireRole(normalized.adminUid, ["admin"]);
  if (!auth.ok) return { success: false, error: auth.error };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return {
      success: false,
      error: "ระบบกำลังประมวลผลรายการอื่นอยู่ กรุณาลองใหม่อีกครั้งครับ",
    };
  }
  try {
    ensureSignatureColumns();
    const normalized = _normalizeApprovalPayload(payload);
    const sh = sheet("WebPendingRequests");
    const rows = sh.getDataRange().getValues();
    const idx = rows.findIndex((r) => String(r[0]) === normalized.reqId);
    if (idx < 0)
      return { success: false, error: "ไม่พบคำขอนี้ (อาจถูกลบหรือหมดอายุ)" };
    if (String(rows[idx][11]) !== "pending")
      return { success: false, error: "รายการนี้ถูกดำเนินการไปแล้ว" };

    const uid = rows[idx][2];
    const userName = rows[idx][3];
    const itemCode = rows[idx][4];
    const itemName = rows[idx][5];
    const qty = Number(rows[idx][6]);
    const category = rows[idx][7];
    const type = rows[idx][9];
    const remark = rows[idx][10] || "";
    const adminUser = getUser(normalized.adminUid);
    const adminName =
      normalized.adminName || (adminUser ? adminUser.name : "Admin");
    // เวลาที่ผู้ใช้ "ยื่นคำขอ" จริง (ไม่ใช่เวลาที่แอดมินกดอนุมัติ) — ใช้บันทึกเป็นวันที่ของ transaction/Logs
    const requestedAt = rows[idx][1] instanceof Date ? rows[idx][1] : new Date(rows[idx][1]);

    try {
      updateStock(itemCode, qty, type, userName, remark, requestedAt);
    } catch (e) {
      return { success: false, error: "ตัดสต็อกไม่สำเร็จ: " + e };
    }

    const signatureUrl = rows[idx].length > 14 ? rows[idx][14] : ""; // ดึงลิงก์ลายเซ็น

    const approvedAt = getThaiNow();
    sh.getRange(idx + 1, 12).setValue("approved");
    sh.getRange(idx + 1, 13).setValue(approvedAt);
    sh.getRange(idx + 1, 14).setValue(adminName);

    const transId = (type === "ยืม" ? "BW" : "WD") + Date.now();
    if (type === "ยืม") {
      sheet("BorrowRequests").appendRow([
        transId,
        requestedAt,
        uid,
        userName,
        itemCode,
        itemName,
        qty,
        category || "-",
        "Web Scanner",
        "approved",
        approvedAt,
        remark,
        signatureUrl, // คอลัมน์ที่ 13 (index 12)
      ]);
    } else {
      sheet("Requests").appendRow([
        transId,
        requestedAt,
        uid,
        userName,
        itemCode,
        itemName,
        qty,
        category,
        "Web Scanner",
        signatureUrl, // คอลัมน์ที่ 10 (index 9)
      ]);
      try {
        sheet("Withdraws").appendRow([
          transId,
          requestedAt,
          uid,
          userName,
          itemCode,
          itemName,
          qty,
          category,
          "", // image column placeholder (col 9)
          signatureUrl, // signatureUrl (col 10)
          remark, // คอลัมน์ที่ 11 (index 10) = หมายเหตุ
        ]);
      } catch (e) {}
    }

    try {
      push(uid, [
        {
          type: "text",
          text: `✅ คำขอ${type} "${itemName}" จำนวน ${qty} ได้รับการอนุมัติแล้วครับ\nตัดสต็อกสำเร็จแล้ว`,
        },
      ]);
    } catch (e) {}
    // แจ้งแอดมินทุกคนทาง LINE ว่ารายการนี้ถูกอนุมัติจากหน้าเว็บแล้ว (กันกดซ้ำจากการ์ดเก่าที่ค้างอยู่ในแชท)
    _notifyAdminsWebAction(
      `✅ อนุมัติ${type} "${itemName}" (${qty}) เรียบร้อย และตัดสต็อกสำเร็จแล้ว\nดำเนินการโดย: ${adminName} (จากหน้าเว็บ)`,
    );
    _writeAudit(
      "APPROVE_WEB_TX",
      `อนุมัติ${type} ${itemName} x${qty} (จากแดชบอร์ด)`,
      adminName,
      normalized.adminUid || "-",
      "admin",
      "Web-Dashboard",
    );

    return { success: true, message: "อนุมัติเรียบร้อย และตัดสต็อกสำเร็จแล้ว" };
  } finally {
    lock.releaseLock();
  }
}

// อนุมัติหลายคำขอพร้อมกันในคลิกเดียว (batch approve)
// ⚡ เวอร์ชันแบบ batch จริง — แก้ปัญหา "เลือกทั้งหมดช้ามาก" ที่เกิดจากโค้ดเดิมซึ่งเรียก
// webApprovePendingRequest() วนลูปทีละรายการ ทำให้แต่ละรายการต้อง: ขอ lock ใหม่, อ่านทั้งชีตใหม่,
// อ่านชีตสต็อกใหม่ทั้งแผ่น, เขียนค่าทีละเซลล์ 3 ครั้ง, แล้วยิง LINE push แยก 2 ครั้ง (ผู้ใช้ + แอดมิน)
// ต่อ 1 รายการ — ถ้าเลือก 20 รายการ = อ่านชีตซ้ำ 20 รอบ + LINE push ~40 ครั้งแบบเรียงลำดับ ช้ามาก
//
// เวอร์ชันนี้ทำทุกอย่างภายใน lock เดียว อ่านชีตที่เกี่ยวข้องครั้งเดียว เขียนกลับเป็น batch
// และยิง LINE แค่ 1 ข้อความสรุปต่อผู้ใช้ 1 คน (ไม่ใช่ต่อ 1 รายการ) + แอดมินอีก 1 ข้อความสรุปรวม
// ปฏิเสธ/ยกเลิกหลายรายการพร้อมกันในคลิกเดียว (batch reject) — ของที่จองไว้จะถูกปล่อยคืนทั้งหมด ไม่มีการตัดสต็อก
function webRejectMultiplePendingRequests(payload) {
  payload = payload || {};
  const reqIds = Array.isArray(payload.reqIds) ? payload.reqIds : [];
  if (!reqIds.length) return { success: false, error: "ไม่มีรายการที่เลือก" };

  const auth = _requireRole(payload.adminUid, ["admin"]);
  if (!auth.ok) return { success: false, error: auth.error };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return {
      success: false,
      error: "ระบบกำลังประมวลผลรายการอื่นอยู่ กรุณาลองใหม่อีกครั้งครับ",
    };
  }

  const rejected = [];
  const failed = [];

  try {
    const adminUser = getUser(payload.adminUid);
    const adminName = payload.adminName || (adminUser ? adminUser.name : "Admin");

    const pendingSh = sheet("WebPendingRequests");
    const allRows = pendingSh.getDataRange().getValues();
    const statusUpdates = [];

    reqIds.forEach(function (reqId) {
      try {
        const idx = allRows.findIndex((r) => String(r[0]) === String(reqId));
        if (idx < 0) {
          failed.push({ reqId: reqId, error: "ไม่พบคำขอนี้ (อาจถูกลบหรือหมดอายุ)" });
          return;
        }
        if (String(allRows[idx][11]) !== "pending") {
          failed.push({ reqId: reqId, error: "รายการนี้ถูกดำเนินการไปแล้ว" });
          return;
        }

        const uid = allRows[idx][2];
        const itemName = allRows[idx][5];
        const qty = allRows[idx][6];
        const type = allRows[idx][9];
        const rejectedAt = getThaiNow();

        statusUpdates.push({ rowIndex: idx + 1, rejectedAt: rejectedAt, adminName: adminName });

        // แจ้งผู้ใช้แต่ละคนว่าคำขอถูกปฏิเสธ (จำเป็น เพราะผู้ใช้ไม่ได้เห็นหน้าแดชบอร์ด)
        try {
          push(uid, [{ type: "text", text: `❌ คำขอ${type} "${itemName}" จำนวน ${qty} ถูกปฏิเสธครับ` }]);
        } catch (e) {}

        try {
          _writeAudit(
            "REJECT_WEB_TX",
            `ปฏิเสธ${type} ${itemName} x${qty} (จากแดชบอร์ด - เลือกหลายรายการ)`,
            adminName,
            payload.adminUid || "-",
            "-",
            "Web-Dashboard",
          );
        } catch (e) {}

        rejected.push(reqId);
      } catch (e) {
        failed.push({ reqId: reqId, error: e.toString() });
      }
    });

    statusUpdates.forEach(function (u) {
      pendingSh.getRange(u.rowIndex, 12, 1, 3).setValues([["rejected", u.rejectedAt, u.adminName]]);
    });

    // แจ้งแอดมินทุกคนทาง LINE แบบสรุปครั้งเดียว (กันกดซ้ำจากการ์ดเก่าที่ค้างอยู่ในแชท ไม่ยิงแยกทีละรายการเพื่อประหยัดโควต้า)
    if (rejected.length > 0) {
      _notifyAdminsWebAction(
        `❌ ปฏิเสธคำขอ ${rejected.length} รายการเรียบร้อย\nดำเนินการโดย: ${adminName} (จากหน้าเว็บ - เลือกหลายรายการ)`,
      );
    }

    return {
      success: rejected.length > 0,
      rejected: rejected,
      failed: failed,
      error: rejected.length === 0 ? "ปฏิเสธไม่สำเร็จทุกรายการ" : undefined,
    };
  } finally {
    lock.releaseLock();
  }
}

function webApproveMultiplePendingRequests(payload) {
  payload = payload || {};
  const reqIds = Array.isArray(payload.reqIds) ? payload.reqIds : [];
  if (!reqIds.length) return { success: false, error: "ไม่มีรายการที่เลือก" };

  const auth = _requireRole(payload.adminUid, ["admin"]);
  if (!auth.ok) return { success: false, error: auth.error };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return {
      success: false,
      error: "ระบบกำลังประมวลผลรายการอื่นอยู่ กรุณาลองใหม่อีกครั้งครับ",
    };
  }

  const approved = [];
  const failed = [];

  try {
    ensureSignatureColumns();
    const adminUser = getUser(payload.adminUid);
    const adminName = payload.adminName || (adminUser ? adminUser.name : "Admin");

    const pendingSh = sheet("WebPendingRequests");
    const allRows = pendingSh.getDataRange().getValues();

    // โหลดชีตสต็อก (Items, Tools) มาไว้ใน cache ในหน่วยความจำครั้งเดียว
    // แทนที่จะอ่านทั้งชีตซ้ำทุกครั้งที่อนุมัติ 1 รายการเหมือนโค้ดเดิม
    const stockSheets = {};
    ["Items", "Tools"].forEach(function (name) {
      const sh = sheet(name);
      stockSheets[name] = { sh: sh, rows: sh.getDataRange().getValues(), dirty: false };
    });

    function findStockRow(itemCode) {
      for (const name of ["Items", "Tools"]) {
        const rows = stockSheets[name].rows;
        for (let i = 1; i < rows.length; i++) {
          if (String(rows[i][0]).trim() === String(itemCode).trim()) {
            return { sheetName: name, rowIdx: i };
          }
        }
      }
      return null;
    }

    const logsRows = [];
    const borrowRows = [];
    const requestRows = [];
    const withdrawRows = [];
    const statusUpdates = [];

    reqIds.forEach(function (reqId) {
      try {
        const idx = allRows.findIndex((r) => String(r[0]) === String(reqId));
        if (idx < 0) {
          failed.push({ reqId: reqId, error: "ไม่พบคำขอนี้ (อาจถูกลบหรือหมดอายุ)" });
          return;
        }
        if (String(allRows[idx][11]) !== "pending") {
          failed.push({ reqId: reqId, error: "รายการนี้ถูกดำเนินการไปแล้ว" });
          return;
        }

        const uid = allRows[idx][2];
        const userName = allRows[idx][3];
        const itemCode = allRows[idx][4];
        const itemName = allRows[idx][5];
        const qty = Number(allRows[idx][6]);
        const category = allRows[idx][7];
        const type = allRows[idx][9];
        const remark = allRows[idx][10] || "";
        const signatureUrl = allRows[idx].length > 14 ? allRows[idx][14] : "";

        const found = findStockRow(itemCode);
        if (!found) {
          failed.push({ reqId: reqId, error: "ไม่พบรหัสสินค้าในสต็อก" });
          return;
        }
        const cache = stockSheets[found.sheetName];
        const stockRow = cache.rows[found.rowIdx];

        const isMinus = type === "เบิก" || type === "ยืม" || type === "แจ้งชำรุด";
        const ns = isMinus ? Number(stockRow[5]) - qty : Number(stockRow[5]) + qty;
        if (ns < 0) {
          failed.push({ reqId: reqId, error: `ตัดสต็อกไม่สำเร็จ: Stock ไม่พอ (คงเหลือ ${stockRow[5]})` });
          return;
        }

        // อัปเดตค่าใน cache ก่อน (ยังไม่เขียนลงชีตจริง) เพื่อให้รายการถัดไปที่เป็นสินค้าตัวเดียวกัน
        // ในชุดที่เลือกไว้ หักลบสต็อกต่อกันถูกต้อง แล้วค่อยเขียนกลับชีตจริงทีเดียวตอนจบ
        stockRow[5] = ns;
        cache.dirty = true;

        const minStock = Number(stockRow[4] || 0);
        const lowStockPct = getLowStockPercent(); // null ถ้าปิดใช้งานแจ้งเตือน
        if (lowStockPct !== null && ns <= minStock * (lowStockPct / 100)) {
          try {
            notifyLowStock({ name: stockRow[1], stock: ns, unit: stockRow[3] });
          } catch (e) {}
        }

        const sign = isMinus ? "-" : "+";
        // เวลาที่ผู้ใช้ "ยื่นคำขอ" จริง (ไม่ใช่เวลาที่แอดมินกดอนุมัติ) — ใช้บันทึกเป็นวันที่ของ Logs
        const requestedAtForLog = allRows[idx][1] instanceof Date ? allRows[idx][1] : new Date(allRows[idx][1]);
        logsRows.push([requestedAtForLog, itemCode, stockRow[1], sign + qty, ns, "LINE", type, userName, remark]);
        try {
          _writeAudit(
            type,
            `[${itemCode}] ${stockRow[1]} ${sign + qty} → คงเหลือ ${ns}${remark ? " | หมายเหตุ: " + remark : ""}`,
            userName,
            "-",
            "-",
            "LINE",
          );
        } catch (e) {}

        const approvedAt = getThaiNow();
        // เวลาที่ผู้ใช้ "ยื่นคำขอ" จริง (ไม่ใช่เวลาที่แอดมินกดอนุมัติ) — ใช้บันทึกเป็นวันที่ของ transaction
        const requestedAt = allRows[idx][1] instanceof Date ? allRows[idx][1] : new Date(allRows[idx][1]);
        const transId = (type === "ยืม" ? "BW" : "WD") + Date.now() + "_" + Math.floor(Math.random() * 10000);

        if (type === "ยืม") {
          borrowRows.push([transId, requestedAt, uid, userName, itemCode, itemName, qty, category || "-", "Web Scanner", "approved", approvedAt, remark, signatureUrl]);
        } else {
          requestRows.push([transId, requestedAt, uid, userName, itemCode, itemName, qty, category, "Web Scanner", signatureUrl]);
          withdrawRows.push([transId, requestedAt, uid, userName, itemCode, itemName, qty, category, "", signatureUrl, remark]);
        }

        statusUpdates.push({ rowIndex: idx + 1, approvedAt: approvedAt, adminName: adminName });

        approved.push(reqId);
      } catch (e) {
        failed.push({ reqId: reqId, error: e.toString() });
      }
    });

    // ── เขียนสถานะกลับลง WebPendingRequests: 1 คำสั่งเขียนต่อ 1 แถว (3 คอลัมน์พร้อมกัน) ──
    // แทนที่จะเป็น setValue ทีละเซลล์ 3 ครั้งต่อแถวเหมือนเดิม
    statusUpdates.forEach(function (u) {
      pendingSh.getRange(u.rowIndex, 12, 1, 3).setValues([["approved", u.approvedAt, u.adminName]]);
    });

    // ── เขียนชีตสต็อกที่มีการเปลี่ยนแปลงกลับ ครั้งเดียวต่อชีต (ไม่ใช่ครั้งเดียวต่อรายการ) ──
    Object.keys(stockSheets).forEach(function (name) {
      const c = stockSheets[name];
      if (c.dirty) {
        c.sh.getRange(1, 1, c.rows.length, c.rows[0].length).setValues(c.rows);
      }
    });

    // ── เขียนแถวใหม่แบบ batch (setValues ครั้งเดียวต่อชีต แทน appendRow ทีละแถว) ──
    function bulkAppend(sheetName, rows) {
      if (!rows.length) return;
      const sh = sheet(sheetName);
      const startRow = sh.getLastRow() + 1;
      sh.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
    }
    bulkAppend("Logs", logsRows);
    bulkAppend("BorrowRequests", borrowRows);
    bulkAppend("Requests", requestRows);
    bulkAppend("Withdraws", withdrawRows);

    // หมายเหตุ: ไม่ส่ง LINE push แจ้งผู้ใช้ที่ยื่นคำขอแล้ว (ตามที่ขอ) — ผู้ใช้จะเห็นสถานะ
    // "รายการค้างอนุมัติ" ของตัวเองผ่านหน้า QR (badge/แจ้งเตือนในแอป) แทน ผ่าน webGetMyPendingRequests()
    // แจ้งแอดมินทุกคนทาง LINE แบบสรุปครั้งเดียว (กันกดซ้ำจากการ์ดเก่าที่ค้างอยู่ในแชท ไม่ยิงแยกทีละรายการเพื่อประหยัดโควต้า)
    if (approved.length > 0) {
      _notifyAdminsWebAction(
        `✅ อนุมัติคำขอ ${approved.length} รายการ และตัดสต็อกสำเร็จแล้ว\nดำเนินการโดย: ${adminName} (จากหน้าเว็บ - เลือกหลายรายการ)`,
      );
    }

    return {
      success: approved.length > 0,
      approved: approved,
      failed: failed,
      error: approved.length === 0 ? "อนุมัติไม่สำเร็จทุกรายการ" : undefined,
    };
  } finally {
    lock.releaseLock();
  }
}

// ปฏิเสธคำขอ เบิก/ยืม จากแดชบอร์ดเว็บ
function webRejectPendingRequest(payload) {
  payload = payload || {};
  const normalized = _normalizeApprovalPayload(payload);
  const auth = _requireRole(normalized.adminUid, ["admin"]);
  if (!auth.ok) return { success: false, error: auth.error };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return {
      success: false,
      error: "ระบบกำลังประมวลผลรายการอื่นอยู่ กรุณาลองใหม่อีกครั้งครับ",
    };
  }
  try {
    const normalized = _normalizeApprovalPayload(payload);
    const sh = sheet("WebPendingRequests");
    const rows = sh.getDataRange().getValues();
    const idx = rows.findIndex((r) => String(r[0]) === normalized.reqId);
    if (idx < 0)
      return { success: false, error: "ไม่พบคำขอนี้ (อาจถูกลบหรือหมดอายุ)" };
    if (String(rows[idx][11]) !== "pending")
      return { success: false, error: "รายการนี้ถูกดำเนินการไปแล้ว" };

    const uid = rows[idx][2];
    const itemName = rows[idx][5];
    const qty = rows[idx][6];
    const type = rows[idx][9];
    const adminUser = getUser(normalized.adminUid);
    const adminName =
      normalized.adminName || (adminUser ? adminUser.name : "Admin");

    const rejectedAt = getThaiNow();
    sh.getRange(idx + 1, 12).setValue("rejected");
    sh.getRange(idx + 1, 13).setValue(rejectedAt);
    sh.getRange(idx + 1, 14).setValue(adminName);

    try {
      push(uid, [
        {
          type: "text",
          text: `❌ คำขอ${type} "${itemName}" จำนวน ${qty} ถูกปฏิเสธครับ`,
        },
      ]);
    } catch (e) {}
    // แจ้งแอดมินทุกคนทาง LINE ว่ารายการนี้ถูกปฏิเสธจากหน้าเว็บแล้ว (กันกดซ้ำจากการ์ดเก่าที่ค้างอยู่ในแชท)
    _notifyAdminsWebAction(
      `❌ ปฏิเสธ${type} "${itemName}" (${qty}) เรียบร้อย\nดำเนินการโดย: ${adminName} (จากหน้าเว็บ)`,
    );
    _writeAudit(
      "REJECT_WEB_TX",
      `ปฏิเสธ${type} ${itemName} x${qty} (จากแดชบอร์ด)`,
      adminName,
      normalized.adminUid || "-",
      "admin",
      "Web-Dashboard",
    );

    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function sendActiveBorrows(userId, token) {
  const reqData = sheet("BorrowRequests").getDataRange().getValues().slice(1);
  const myBorrows = reqData.filter(
    (r) => String(r[2]) === userId && r[9] === "approved",
  );
  if (myBorrows.length === 0) {
    return reply(token, "🎉 ไม่มีรายการค้าง");
  }
  const settings = getSettings();
  const tColor = settings.themeColor || THEME_COLOR;

  const bubbles = myBorrows.map((r) => {
    return {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "🛠️ รายการยืมค้าง",
            weight: "bold",
            color: "#FFFFFF",
          },
        ],
        backgroundColor: tColor,
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: r[5], weight: "bold" },
          { type: "text", text: `จำนวน: ${r[6]}` },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            action: {
              type: "postback",
              label: "↩️ คืน",
              data: "return_select:" + r[0],
              displayText: "คืน: " + r[5],
            },
            style: "primary",
            color: COLOR_SUCCESS,
          },
        ],
      },
    };
  });
  const flexObj = {
    type: "flex",
    altText: "คืนของ",
    contents: { type: "carousel", contents: bubbles },
  };
  replyFlex(token, flexObj);
}

function submitReturn(userId, replyToken, itemCode, qty, settings) {
  const reqId = cacheGet(userId, "return_req_id");
  if (!reqId) {
    return reply(replyToken, "❌ หมดอายุ");
  }
  const img = cacheGet(userId, "image");
  if (!img) {
    return reply(replyToken, "⛔ ถ่ายรูปก่อน");
  }
  const sh = sheet("BorrowRequests");
  const rows = sh.getDataRange().getValues();
  const idx = rows.findIndex((r) => String(r[0]) === reqId);
  if (idx < 0) {
    return reply(replyToken, "❌ ไม่พบ");
  }
  const returnedAt = getThaiNow();
  sh.getRange(idx + 1, 10).setValue("returned");
  sh.getRange(idx + 1, 11).setValue(returnedAt);
  const user = getUser(userId);
  updateStock(itemCode, qty, "คืน", user.name);
  const info = getItemInfo(itemCode, "Tools");
  const logRow = [
    "RT" + Date.now(),
    new Date(),
    userId,
    user.name,
    itemCode,
    info.name,
    qty,
    img,
    reqId,
  ];
  sheet("ReturnLogs").appendRow(logRow);

  _writeAudit(
    "คืน",
    `คืนสินค้า (LINE): [${itemCode}] ${info.name} จำนวน ${qty} | reqId: ${reqId}`,
    user.name,
    userId,
    user.role,
    "LINE",
  );
  clearItemData(userId);
  CacheService.getScriptCache().remove(userId + "_return_req_id");
  const replyMessages = [
    { type: "text", text: `✅ คืนเรียบร้อย!\n📦 ${info.name}` },
    flexMenu(user.role, user.name, settings, userId),
  ];
  send(replyToken, replyMessages);
}

function getBorrowRequestById(reqId) {
  const rows = sheet("BorrowRequests").getDataRange().getValues();
  const r = rows.find((row) => String(row[0]) === reqId);
  if (r) {
    return {
      reqId: r[0],
      userId: r[2],
      itemCode: r[4],
      itemName: r[5],
      qty: Number(r[6]),
      category: r[7],
      imageUrl: r[8],
      status: r[9],
    };
  }
  return null;
}

function searchItem(keyword, replyToken, settings) {
  const itemsData = sheet("Items").getDataRange().getValues().slice(1);
  const toolsData = sheet("Tools").getDataRange().getValues().slice(1);
  const mappedItems = itemsData.map((r) => ({ ...r, sheet: "Items" }));
  const mappedTools = toolsData.map((r) => ({ ...r, sheet: "Tools" }));
  const all = mappedItems.concat(mappedTools);
  const results = all.filter((r) => {
    const nameMatch = String(r[1])
      .toLowerCase()
      .includes(keyword.toLowerCase());
    const codeMatch = String(r[0])
      .toLowerCase()
      .includes(keyword.toLowerCase());
    return nameMatch || codeMatch;
  });
  if (results.length === 0) {
    return reply(replyToken, `🔍 ไม่พบ "${keyword}"`);
  }
  const tColor = settings.themeColor || THEME_COLOR;

  const bubbles = results.slice(0, 10).map((r) => {
    return {
      type: "bubble",
      size: "micro",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: r[1], weight: "bold", size: "sm", wrap: true },
          { type: "text", text: r[0], size: "xxs" },
          {
            type: "text",
            text: "เหลือ: " + r[5],
            color: r[5] > 0 ? COLOR_SUCCESS : COLOR_DANGER,
            weight: "bold",
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            action: {
              type: "postback",
              label: "เลือก",
              data: `item:${r[0]}:${r.sheet}`,
              displayText: "เลือก: " + r[1],
            },
            style: "primary",
            color: tColor,
          },
        ],
      },
    };
  });
  const flexObj = {
    type: "flex",
    altText: "ผลการค้นหา",
    contents: { type: "carousel", contents: bubbles },
  };
  replyFlex(replyToken, flexObj);
}

/**************** FLEX UI GENERATORS ****************/
// การ์ดต้อนรับสมาชิกใหม่ (ตอน follow) — ฟิกปุ่มพาไปหน้าเว็บทำรายการเบิกโดยตรง
function flexWelcomeEntry(settings) {
  const tColor = settings.themeColor || THEME_COLOR;
  const sysName = settings.sysName || "คลังอะไหล่เมาท์เทน";
  const entryUrl = "https://thaipeter.github.io/stockCyberbay/";

  return {
    type: "flex",
    altText: "ยินดีต้อนรับ — กดเพื่อทำรายการเบิก",
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "🎉 ยินดีต้อนรับ",
            weight: "bold",
            size: "xl",
            color: "#FFFFFF",
          },
          {
            type: "text",
            text: sysName,
            size: "sm",
            color: "#FFFFFFCC",
            margin: "xs",
          },
        ],
        backgroundColor: tColor,
        paddingAll: "xl",
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "lg",
        contents: [
          {
            type: "text",
            text: "ระบบคลังอะไหล่พร้อมให้บริการแล้วครับ 👇\nกดปุ่มด้านล่างเพื่อเริ่มทำรายการเบิกได้เลย",
            size: "sm",
            color: "#555555",
            wrap: true,
          },
          {
            type: "button",
            action: {
              type: "uri",
              label: "📲 ทำรายการเบิก",
              uri: entryUrl,
            },
            style: "primary",
            color: tColor,
            height: "md",
            margin: "lg",
          },
        ],
        paddingAll: "xl",
      },
    },
  };
}

function flexMenu(role, name, settings, uid) {
  const isAdmin = String(role).toLowerCase() === "admin";
  const tColor = settings.themeColor || THEME_COLOR;
  const sysName = settings.sysName || "คลังอะไหล่เมาท์เทน";
  let webUrl = ScriptApp.getService().getUrl();
  let scanUrl = webUrl;
  let txUrl = webUrl; // URL หน้าเบิก/ยืม (code.html)
  if (webUrl && uid) {
    const separator = webUrl.includes("?") ? "&" : "?";
    // เปลี่ยนให้ลิงก์สแกนชี้ไปที่หน้า Scanner โดยตรง
    scanUrl = webUrl + "?page=scanner&uid=" + uid;
    txUrl = webUrl + "?page=transaction&uid=" + uid;
  }
  if (!scanUrl) scanUrl = "https://line.me/R/nv/qrcode"; // Fallback
  const buttons = [
    {
      type: "button",
      action: { type: "uri", label: "📲 ทำรายการ (เบิก/ยืม)", uri: txUrl },
      style: "primary",
      color: tColor,
    },
    {
      type: "button",
      action: {
        type: "message",
        label: "📦 เบิกคลังอะไหล่ (LINE)",
        text: "เบิก",
      },
      style: "secondary",
      color: tColor,
    },
    {
      type: "button",
      action: { type: "message", label: "🛠️ ยืมเครื่องมือ", text: "ยืม" },
      style: "primary",
      color: "#E67E22",
    },
    {
      type: "button",
      action: { type: "message", label: "↩️ คืนเครื่องมือ", text: "คืน" },
      style: "primary",
      color: "#3498DB",
    },
    {
      type: "button",
      action: { type: "uri", label: "📷 สแกน QR Code", uri: scanUrl },
      style: "secondary",
      color: COLOR_SUCCESS,
    },
  ];
  if (isAdmin) {
    buttons.push({
      type: "button",
      action: { type: "message", label: "📥 รับของเข้าสต็อก", text: "รับเข้า" },
      style: "secondary",
      color: COLOR_SUCCESS,
    });
    buttons.push({
      type: "button",
      action: {
        type: "postback",
        label: "✨ เพิ่มรายการใหม่",
        data: "new_item_start",
        displayText: "✨ เพิ่มรายการใหม่",
      },
      style: "secondary",
      color: "#8E44AD",
    });
    buttons.push({
      type: "button",
      action: { type: "message", label: "🔧 ปรับยอดสต็อก", text: "ปรับยอด" },
      style: "secondary",
      color: COLOR_ADJUST,
    });
  }
  return {
    type: "flex",
    altText: "เมนูหลัก",
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: sysName,
            weight: "bold",
            size: "xl",
            color: "#FFFFFF",
          },
          {
            type: "text",
            text: `สวัสดีครับคุณ ${name} (${role})`,
            size: "xs",
            color: "#FFFFFFCC",
          },
        ],
        backgroundColor: tColor,
        paddingAll: "lg",
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          ...buttons,
          { type: "separator", margin: "lg" },
          {
            type: "button",
            action: {
              type: "message",
              label: "📊 ดูสต็อกคงเหลือ",
              text: "ดูสต็อก",
            },
            style: "link",
            color: "#555555",
            height: "sm",
          },
          {
            type: "button",
            action: { type: "message", label: "📜 ดูประวัติ", text: "ประวัติ" },
            style: "link",
            color: "#555555",
            height: "sm",
          },
          {
            type: "text",
            text: "พิมพ์ 'ค้นหา [ชื่อสินค้า]' เพื่อหาของ",
            size: "xxs",
            color: "#AAAAAA",
            align: "center",
            margin: "md",
          },
        ],
        paddingAll: "lg",
      },
    },
  };
}

function flexHistoryTypeSelection(settings) {
  const tColor = settings.themeColor || THEME_COLOR;
  return {
    type: "flex",
    altText: "ประวัติ",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "📜 เลือกประเภทประวัติ",
            weight: "bold",
            size: "lg",
          },
          {
            type: "button",
            action: {
              type: "message",
              label: "📦 ประวัติการเบิก/รับเข้า",
              text: "ประวัติสต็อก",
            },
            style: "primary",
            color: tColor,
          },
          {
            type: "button",
            action: {
              type: "message",
              label: "🛠️ ประวัติการยืม/คืน",
              text: "ประวัติเครื่องมือ",
            },
            style: "secondary",
          },
        ],
      },
    },
  };
}

function flexTypeSelectionForNewItem(settings) {
  const tColor = settings.themeColor || THEME_COLOR;
  return {
    type: "flex",
    altText: "เลือกประเภทสินค้าใหม่",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "✨ เพิ่มรายการใหม่",
            weight: "bold",
            size: "lg",
          },
          {
            type: "button",
            action: {
              type: "postback",
              label: "📦 คลังอะไหล่",
              data: "new_item_type:Items",
              displayText: "เพิ่ม: คลังอะไหล่",
            },
            style: "primary",
            color: tColor,
          },
          {
            type: "button",
            action: {
              type: "postback",
              label: "🛠️ เครื่องมือ",
              data: "new_item_type:Tools",
              displayText: "เพิ่ม: เครื่องมือ",
            },
            style: "secondary",
          },
        ],
      },
    },
  };
}

function flexMachine(mode, settings) {
  const targetSheet = getSheetNameByMode(mode);
  const tc =
    mode === "ยืม" || mode === "คืน"
      ? "#E67E22"
      : settings.themeColor || THEME_COLOR;
  const rows = sheet(targetSheet).getDataRange().getValues().slice(1);
  const machines = [
    ...new Set(rows.filter((r) => r[2]).map((r) => normalizeText(r[2]))),
  ];
  if (machines.length === 0) {
    return {
      type: "flex",
      altText: "เลือกหมวด",
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [{ type: "text", text: "❌ ไม่พบหมวดหมู่" }],
        },
      },
    };
  }
  const bubbles = [];
  for (let i = 0; i < machines.length && i < 100; i += 10) {
    const chunk = machines.slice(i, i + 10);
    const buttons = chunk.map((l, idx) => {
      let shortLabel = String(i + idx + 1) + ". " + String(l);
      if (shortLabel.length > 20) {
        shortLabel = shortLabel.substring(0, 18) + "..";
      }
      return {
        type: "button",
        action: {
          type: "postback",
          label: shortLabel,
          data: "machine:" + l,
          displayText: "เลือกหมวด: " + l,
        },
        style: "secondary",
        height: "sm",
        margin: "sm",
      };
    });
    bubbles.push({
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: `เลือกหมวดหมู่ (${Math.floor(i / 10) + 1})`,
            weight: "bold",
            color: "#FFFFFF",
          },
        ],
        backgroundColor: tc,
      },
      body: { type: "box", layout: "vertical", contents: buttons },
    });
  }
  return {
    type: "flex",
    altText: "เลือกหมวด",
    contents: { type: "carousel", contents: bubbles },
  };
}

function flexItems(category, userId, settings) {
  const mode = cacheGet(userId, "mode") || "เบิก";
  const ts = getSheetNameByMode(mode);
  const tColor = settings.themeColor || THEME_COLOR;
  let bMap = {};
  if (ts === "Tools") {
    const borrowRows = sheet("BorrowRequests")
      .getDataRange()
      .getValues()
      .slice(1);
    borrowRows
      .filter((r) => r[8] === "approved")
      .forEach((r) => {
        if (!bMap[r[4]]) {
          bMap[r[4]] = [];
        }
        bMap[r[4]].push(r[3]);
      });
  }
  const allDataRows = sheet(ts).getDataRange().getValues().slice(1);
  const items = allDataRows
    .filter((r) => r[0] && normalizeText(r[2]) === normalizeText(category))
    .map((r) => {
      return {
        name: r[1],
        code: r[0],
        stock: Number(r[5] || 0),
        unit: r[3] || "หน่วย",
      };
    });
  if (items.length === 0) {
    return null;
  }
  const bubbles = [];
  for (let i = 0; i < items.length && i < 120; i += 10) {
    const chunk = items.slice(i, i + 10);
    const rows = chunk.map((l, idx) => {
      let boxContent = {
        type: "box",
        layout: "horizontal",
        contents: [
          {
            type: "text",
            text: `${i + idx + 1}. ${l.name}`,
            size: "sm",
            flex: 7,
          },
          {
            type: "text",
            text: String(l.stock),
            color: l.stock > 0 ? COLOR_SUCCESS : COLOR_DANGER,
            flex: 2,
            align: "end",
            weight: "bold",
          },
        ],
        action: {
          type: "postback",
          data: `item:${l.code}:${ts}`,
          displayText: "เลือก: " + l.name,
        },
        backgroundColor: "#F8F9F9",
        cornerRadius: "md",
        paddingAll: "md",
        margin: "sm",
      };
      if (bMap[l.code]) {
        return {
          type: "box",
          layout: "vertical",
          contents: [
            boxContent,
            {
              type: "text",
              text: "👤 ยืมโดย: " + bMap[l.code].join(", "),
              size: "xxs",
              color: COLOR_DANGER,
              margin: "xs",
            },
          ],
        };
      }
      return boxContent;
    });
    bubbles.push({
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: category, weight: "bold", color: "#FFFFFF" },
        ],
        backgroundColor: tColor,
      },
      body: { type: "box", layout: "vertical", contents: rows },
    });
  }
  return {
    type: "flex",
    altText: "รายการสินค้า",
    contents: { type: "carousel", contents: bubbles },
  };
}

function flexConfirm(data, settings) {
  let themeColor = settings.themeColor || THEME_COLOR;
  if (data.mode === "รับเข้า") {
    themeColor = COLOR_SUCCESS;
  } else if (data.mode === "ยืม") {
    themeColor = "#E67E22";
  } else if (data.mode === "คืน") {
    themeColor = "#3498DB";
  } else if (data.mode === "ปรับยอด") {
    themeColor = COLOR_ADJUST;
  }

  return {
    type: "flex",
    altText: "ยืนยันรายการ",
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: `ยืนยันการ${data.mode}`,
            weight: "bold",
            color: "#FFFFFF",
          },
        ],
        backgroundColor: themeColor,
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "รายการ: " + data.itemName },
          {
            type: "text",
            text: "จำนวน: " + data.qty,
            size: "xl",
            weight: "bold",
            color: themeColor,
          },
          {
            type: "box",
            layout: "horizontal",
            margin: "md",
            spacing: "md",
            contents: [
              {
                type: "button",
                action: {
                  type: "postback",
                  label: "❌ ยกเลิก",
                  data: "cancel",
                  displayText: "❌ ยกเลิก",
                },
                style: "secondary",
              },
              {
                type: "button",
                action: {
                  type: "postback",
                  label: "✅ ยืนยัน",
                  data: `confirm|${data.itemCode}|${data.qty}|${data.mode}`,
                  displayText: "✅ ยืนยัน",
                },
                style: "primary",
                color: themeColor,
              },
            ],
          },
        ],
      },
    },
  };
}

function flexConfirmNewItem(data) {
  return {
    type: "flex",
    altText: "ยืนยันรายการใหม่",
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "✨ ยืนยันรายการใหม่",
            weight: "bold",
            color: "#FFFFFF",
          },
        ],
        backgroundColor: THEME_COLOR,
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          lineItem("รหัส", data.code),
          lineItem("ชื่อ", data.name),
          lineItem("เริ่ม", data.qty + " " + data.unit, COLOR_SUCCESS, "bold"),
        ],
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          {
            type: "button",
            action: { type: "message", label: "❌ ยกเลิก", text: "ยกเลิก" },
            style: "secondary",
            color: COLOR_DANGER,
          },
          {
            type: "button",
            action: {
              type: "postback",
              label: "✅ บันทึก",
              data: "new_item_confirm",
              displayText: "✅ บันทึกรายการใหม่",
            },
            style: "primary",
            color: BTN_PRIMARY,
          },
        ],
      },
    },
  };
}

function flexCategoryForNewItem(targetSheetName, settings) {
  const rows = sheet(targetSheetName).getDataRange().getValues().slice(1);
  const machines = [...new Set(rows.filter((r) => r[2]).map((r) => r[2]))];
  const bubbles = [];
  for (let i = 0; i < machines.length && i < 100; i += 10) {
    const chunk = machines.slice(i, i + 10);
    const buttons = chunk.map((l, idx) => {
      let shortLabel = String(i + idx + 1) + ". " + String(l);
      if (shortLabel.length > 20) {
        shortLabel = shortLabel.substring(0, 18) + "..";
      }
      return {
        type: "button",
        action: {
          type: "postback",
          label: shortLabel,
          data: "new_item_cat:" + l,
          displayText: "หมวด: " + l,
        },
        style: "secondary",
        margin: "sm",
      };
    });
    bubbles.push({
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: `🆕 เลือกหมวด (${targetSheetName})`,
            weight: "bold",
            color: "#FFFFFF",
          },
        ],
        backgroundColor: "#8E44AD",
      },
      body: { type: "box", layout: "vertical", contents: buttons },
    });
  }
  return {
    type: "flex",
    altText: "เลือกหมวด",
    contents: { type: "carousel", contents: bubbles },
  };
}

/**************** NEW ITEM WIZARD HANDLERS ****************/
function handleNewItemProcess(userId, replyToken, text, imageId) {
  const step = Number(cacheGet(userId, "newItemStep"));
  let data = JSON.parse(cacheGet(userId, "newItemData") || "{}");
  switch (step) {
    case 1:
      data.name = text;
      cacheSet(userId, "newItemData", JSON.stringify(data));
      cacheSet(userId, "newItemStep", "2");
      return reply(replyToken, "Step 2/5: พิมพ์หน่วยนับ:");
    case 2:
      data.unit = text;
      cacheSet(userId, "newItemData", JSON.stringify(data));
      cacheSet(userId, "newItemStep", "3");
      return reply(replyToken, "Step 3/5: พิมพ์ Min Stock (0 ถ้าไม่กำหนด):");
    case 3:
      if (isNaN(text)) {
        return reply(replyToken, "❌ ตัวเลขเท่านั้น");
      }
      data.min = Number(text);
      cacheSet(userId, "newItemData", JSON.stringify(data));
      cacheSet(userId, "newItemStep", "4");
      return reply(replyToken, "Step 4/5: ยอดเริ่มต้น:");
    case 4:
      if (isNaN(text)) {
        return reply(replyToken, "❌ ตัวเลขเท่านั้น");
      }
      data.qty = Number(text);
      cacheSet(userId, "newItemData", JSON.stringify(data));
      cacheSet(userId, "newItemStep", "5");
      return reply(
        replyToken,
        "Step 5/5: ถ่ายรูปสินค้า (หรือพิมพ์ 'ไม่มี' เพื่อข้าม):",
      );
    case 5:
      data.image = "-";
      if (imageId) {
        try {
          const url = `https://api-data.line.me/v2/bot/message/${imageId}/content`;
          const b = UrlFetchApp.fetch(url, {
            headers: { Authorization: "Bearer " + CURRENT_TOKEN },
          }).getBlob();
          const f = getSubFolder(
            DriveApp.getFolderById(FOLDER_ID),
            "Images_Receives",
          ).createFile(b);
          try {
            f.setSharing(
              DriveApp.Access.ANYONE_WITH_LINK,
              DriveApp.Permission.VIEW,
            );
          } catch (e) {
            // Ignore sharing error
          }
          data.image =
            "https://drive.google.com/thumbnail?id=" + f.getId() + "&sz=w400";
        } catch (e) {
          // Ignore blob error
        }
      }
      cacheSet(userId, "newItemData", JSON.stringify(data));
      return replyFlex(replyToken, flexConfirmNewItem(data));
  }
}

function getNextItemCode(category, type, settings) {
  let defaultPrefix =
    type === "Tools"
      ? settings.prefixTool || "TL"
      : settings.prefixItem || "IT";
  const rows = sheet(type).getDataRange().getValues().slice(1);
  let prefix = defaultPrefix;

  // ตรวจสอบว่าหมวดหมู่มีการผูกตัวย่อไว้หรือไม่
  if (settings.categories && category) {
    let parts = settings.categories.split(",");
    for (let p of parts) {
      let str = p.trim();
      if (str.includes(":")) {
        let [c, pref] = str.split(":");
        if (c.trim() === category.trim() && pref.trim() !== "") {
          prefix = pref.trim().toUpperCase();
          break;
        }
      }
    }
  }

  // ค้นหาเลขถัดไปจากทั้งรายการอะไหล่และเครื่องมือ เพื่อป้องกันรหัสซ้ำ
  const allRows = sheet("Items")
    .getDataRange()
    .getValues()
    .slice(1)
    .concat(sheet("Tools").getDataRange().getValues().slice(1));
  let maxNum = 0;
  allRows.forEach((r) => {
    if (r[0]) {
      let codeStr = String(r[0]);
      if (codeStr.startsWith(prefix)) {
        let numPart = "";
        if (codeStr.includes("-")) {
          let p = codeStr.split("-");
          if (p[0] === prefix) numPart = p[1];
        } else {
          numPart = codeStr.substring(prefix.length);
        }
        let num = parseInt(numPart, 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    }
  });

  return `${prefix}-${String(maxNum + 1).padStart(3, "0")}`;
}

// เวอร์ชันสำหรับหน้าเว็บ (qr.gs) — รับ prefix ตรงๆ แทน category/type
// เพื่อยืนยันรหัสสินค้าถัดไปกับข้อมูลจริงในชีต (กันรหัสชนกันตอนมีคนเพิ่มพร้อมกัน)
function webGetNextCode(payload) {
  try {
    const rawPrefix = (payload && payload.prefix) || "";
    const prefix = String(rawPrefix).replace(/-+$/, "").toUpperCase().trim();
    if (!prefix) {
      return { success: false, error: "ไม่พบ prefix" };
    }

    const candidatePrefix = prefix + "-";
    const allRows = sheet("Items")
      .getDataRange()
      .getValues()
      .slice(1)
      .concat(sheet("Tools").getDataRange().getValues().slice(1));

    let maxNum = 0;
    let maxLen = 3;
    allRows.forEach((r) => {
      const codeStr = String(r[0] || "")
        .toUpperCase()
        .trim();
      if (!codeStr.startsWith(candidatePrefix)) return;
      const suffix = codeStr.slice(candidatePrefix.length);
      if (!/^\d+$/.test(suffix)) return;
      const num = parseInt(suffix, 10);
      if (!isNaN(num)) {
        maxNum = Math.max(maxNum, num);
        maxLen = Math.max(maxLen, suffix.length);
      }
    });

    const nextCode = `${candidatePrefix}${String(maxNum + 1).padStart(maxLen, "0")}`;
    return { success: true, nextCode: nextCode };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function submitNewItem(userId, replyToken, settings) {
  const data = JSON.parse(cacheGet(userId, "newItemData"));
  const type = cacheGet(userId, "newItemType") || "Items";
  if (!data || !data.code) {
    return reply(replyToken, "❌ ข้อมูลหมดอายุ กรุณาทำรายการใหม่");
  }
  const user = getUser(userId);
  if (user.role !== "admin") {
    return reply(replyToken, "⛔ เฉพาะ Admin");
  }
  sheet(type).appendRow([
    data.code,
    data.name,
    data.category,
    data.unit,
    data.min,
    data.qty,
  ]);
  sheet("Receives").appendRow([
    "NEW" + Date.now(),
    new Date(),
    "WEB",
    user.name,
    `รับเข้า (${type})`,
    data.code,
    data.name,
    data.qty,
    data.category,
    data.image,
    "approved",
  ]);
  sheet("Logs").appendRow([
    new Date(),
    data.code,
    data.name,
    "+" + data.qty,
    data.qty,
    "LINE",
    "New Item",
    user.name,
  ]);

  _writeAudit(
    "NEW_ITEM",
    `เพิ่มสินค้าใหม่: [${data.code}] ${data.name} จำนวน ${data.qty} (${type})`,
    user.name,
    userId,
    user.role,
    "LINE",
  );
  clearSession(userId);
  send(replyToken, [
    { type: "text", text: `✅ เพิ่มรายการเรียบร้อย!\n📦 ${data.name}` },
    flexMenu(user.role, user.name, settings, userId),
  ]);
}

/**************** HELPER & UTILS ****************/
function reply(token, text) {
  send(token, [{ type: "text", text: text }]);
}

function replyFlex(token, flex) {
  send(token, [flex]);
}

function send(token, msgs) {
  const options = {
    method: "post",
    headers: {
      Authorization: "Bearer " + CURRENT_TOKEN,
      "Content-Type": "application/json",
    },
    payload: JSON.stringify({ replyToken: token, messages: msgs }),
    muteHttpExceptions: true,
  };
  const res = UrlFetchApp.fetch(
    "https://api.line.me/v2/bot/message/reply",
    options,
  );
  if (res.getResponseCode() !== 200) {
    console.log(res.getContentText());
    try {
      UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
        method: "post",
        headers: {
          Authorization: "Bearer " + CURRENT_TOKEN,
          "Content-Type": "application/json",
        },
        payload: JSON.stringify({
          replyToken: token,
          messages: [
            {
              type: "text",
              text: "❌ เกิดข้อผิดพลาดในการสร้างเมนู\nโปรดตรวจสอบข้อมูลอีกครั้ง",
            },
          ],
        }),
      });
    } catch (e) {
      // Ignore error reporting error
    }
  }
}

function push(userId, msgs, tokenOverride) {
  return UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
    method: "post",
    headers: {
      Authorization: "Bearer " + (tokenOverride || TOKEN),
      "Content-Type": "application/json",
    },
    payload: JSON.stringify({ to: userId, messages: msgs }),
    muteHttpExceptions: true,
  });
}

function saveImage(id, uid) {
  try {
    const url = `https://api-data.line.me/v2/bot/message/${id}/content`;
    const b = UrlFetchApp.fetch(url, {
      headers: { Authorization: "Bearer " + CURRENT_TOKEN },
    }).getBlob();
    const modeStr = cacheGet(uid, "mode");
    const folderName =
      modeStr === "รับเข้า" || modeStr === "ซ่อมแซมแล้ว"
        ? "Images_Receives"
        : "Images_Requests";
    const targetFolder = getSubFolder(
      DriveApp.getFolderById(FOLDER_ID),
      folderName,
    );
    const f = targetFolder.createFile(b);
    try {
      f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (err) {
      // Ignore share error
    }
    cacheSet(
      uid,
      "image",
      "https://drive.google.com/thumbnail?id=" + f.getId() + "&sz=w400",
    );
  } catch (e) {
    // Ignore fetch error
  }
}

function getSubFolder(parent, name) {
  const folders = parent.getFoldersByName(name);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parent.createFolder(name);
}

function sheet(n) {
  const ss = getActiveSpreadsheetInstance();
  let sh = ss.getSheetByName(n);
  if (!sh) {
    sh = ss.insertSheet(n);
    if (n === "Users") {
      sh.appendRow(["UserID", "Name", "Role"]);
    } else if (n === "Items" || n === "Tools") {
      sh.appendRow(["Code", "Name", "Category", "Unit", "Min", "Stock"]);
    } else if (n === "Withdraws" || n === "Requests") {
      sh.appendRow([
        "TransID",
        "Date",
        "UserID",
        "Name",
        "ItemCode",
        "ItemName",
        "Qty",
        "Category",
        "Image",
      ]);
    } else if (n === "Receives") {
      sh.appendRow([
        "TransID",
        "Date",
        "UserID",
        "UserName",
        "Action",
        "ItemCode",
        "ItemName",
        "Qty",
        "Category",
        "Image",
        "Status",
      ]);
    } else if (n === "BorrowRequests") {
      sh.appendRow([
        "ReqID",
        "Date",
        "UserID",
        "Name",
        "ItemCode",
        "ItemName",
        "Qty",
        "Category",
        "Image",
        "Status",
        "ActionDate",
        "Remark",
      ]);
    } else if (n === "ReturnLogs") {
      sh.appendRow([
        "ReturnID",
        "Date",
        "UserID",
        "Name",
        "ItemCode",
        "ItemName",
        "Qty",
        "Image",
        "RefReqID",
      ]);
    } else if (n === "AdjustLogs") {
      sh.appendRow([
        "AdjID",
        "Date",
        "UserID",
        "Name",
        "ItemCode",
        "ItemName",
        "Qty",
        "TargetSheet",
      ]);
    } else if (n === "Logs") {
      sh.appendRow([
        "Date",
        "ItemCode",
        "ItemName",
        "Change",
        "Balance",
        "Channel",
        "Action",
        "User",
        "Remark",
      ]);
    } else if (n === "PendingPO") {
      sh.appendRow([
        "POCode",
        "Date",
        "Supplier",
        "ItemCode",
        "ItemName",
        "Qty",
        "Status",
        "Remark",
        "FileUrl",
      ]);
    } else if (n === "WebPendingRequests") {
      sh.appendRow([
        "ReqID",
        "Date",
        "UserID",
        "Name",
        "ItemCode",
        "ItemName",
        "Qty",
        "Category",
        "Unit",
        "Type",
        "Remark",
        "Status",
        "ActionDate",
        "ActionBy",
      ]);
    } else if (n === "PrintLogs") {
      sh.appendRow([
        "LogID",
        "PrintedAt",
        "ItemCode",
        "ItemName",
        "Type",
        "UserName",
        "UserID",
      ]);
    }
  }
  return sh;
}

/* ============================================================
   QR FAST TRACK — Flex Messages
   flexScanConfirm  : แสดงข้อมูลสินค้า + Quick Reply เลือกจำนวน
   flexScanSuccess  : ยืนยันเบิกสำเร็จ
============================================================ */
function flexScanConfirm(info, settings) {
  const themeColor =
    settings && settings.themeColor ? settings.themeColor : "#4f46e5";
  const stockColor = info.stock <= (info.min || 0) ? "#ef4444" : "#10b981";
  const stockLabel =
    info.stock <= (info.min || 0) ? "⚠️ ใกล้หมด" : "✅ พร้อมเบิก";

  return {
    type: "flex",
    altText: `เบิก: ${info.name}`,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        backgroundColor: themeColor,
        contents: [
          {
            type: "text",
            text: "📦 สแกน QR สำเร็จ",
            size: "xs",
            color: "#ffffff",
            opacity: 0.7,
          },
          {
            type: "text",
            text: info.name,
            size: "md",
            weight: "bold",
            color: "#ffffff",
            wrap: true,
            margin: "xs",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        spacing: "sm",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              {
                type: "text",
                text: "รหัส",
                size: "sm",
                color: "#888888",
                flex: 2,
              },
              {
                type: "text",
                text: info.code,
                size: "sm",
                weight: "bold",
                flex: 3,
              },
            ],
          },
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              {
                type: "text",
                text: "คงเหลือ",
                size: "sm",
                color: "#888888",
                flex: 2,
              },
              {
                type: "text",
                text: `${info.stock} ${info.unit || "ชิ้น"}`,
                size: "sm",
                weight: "bold",
                color: stockColor,
                flex: 3,
              },
            ],
          },
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              {
                type: "text",
                text: "สถานะ",
                size: "sm",
                color: "#888888",
                flex: 2,
              },
              { type: "text", text: stockLabel, size: "sm", flex: 3 },
            ],
          },
          { type: "separator", margin: "md" },
          {
            type: "text",
            text: "เบิกกี่ชิ้น?",
            size: "sm",
            color: "#555555",
            margin: "md",
            weight: "bold",
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "12px",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            spacing: "xs",
            contents: [1, 2, 3, 5, 10].map((n) => ({
              type: "button",
              action: { type: "message", label: String(n), text: String(n) },
              style: n <= info.stock ? "primary" : "secondary",
              color: n <= info.stock ? themeColor : "#cccccc",
              height: "sm",
              flex: 1,
            })),
          },
          {
            type: "button",
            action: { type: "message", label: "✏️ กรอกจำนวนเอง", text: "" },
            style: "secondary",
            height: "sm",
            margin: "xs",
            action: {
              type: "message",
              label: "✏️ กรอกจำนวนเอง",
              text: "กรอกเอง",
            },
          },
          {
            type: "button",
            action: { type: "message", label: "❌ ยกเลิก", text: "ยกเลิก" },
            style: "secondary",
            height: "sm",
            color: "#ef4444",
          },
        ],
      },
    },
    quickReply: {
      items: [1, 2, 3, 5, 10]
        .map((n) => ({
          type: "action",
          action: { type: "message", label: `${n} ชิ้น`, text: String(n) },
        }))
        .concat([
          {
            type: "action",
            action: { type: "message", label: "ยกเลิก", text: "ยกเลิก" },
          },
        ]),
    },
  };
}

function flexScanSuccess(data, settings) {
  const themeColor =
    settings && settings.themeColor ? settings.themeColor : "#4f46e5";
  const now = new Date();
  const timeStr = Utilities.formatDate(now, "Asia/Bangkok", "dd/MM/yyyy HH:mm");

  return {
    type: "flex",
    altText: `✅ เบิกสำเร็จ: ${data.itemName} x${data.qty}`,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        backgroundColor: "#10b981",
        contents: [
          {
            type: "text",
            text: "✅ เบิกสำเร็จ!",
            size: "lg",
            weight: "bold",
            color: "#ffffff",
          },
          {
            type: "text",
            text: timeStr,
            size: "xs",
            color: "#ffffff",
            opacity: 0.7,
            margin: "xs",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        spacing: "sm",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: "สินค้า",
                size: "sm",
                color: "#888888",
                flex: 2,
              },
              {
                type: "text",
                text: data.itemName,
                size: "sm",
                weight: "bold",
                flex: 4,
                wrap: true,
              },
            ],
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: "รหัส",
                size: "sm",
                color: "#888888",
                flex: 2,
              },
              { type: "text", text: data.itemCode, size: "sm", flex: 4 },
            ],
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: "จำนวน",
                size: "sm",
                color: "#888888",
                flex: 2,
              },
              {
                type: "text",
                text: `${data.qty} ${data.unit}`,
                size: "sm",
                weight: "bold",
                color: "#10b981",
                flex: 4,
              },
            ],
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: "คงเหลือ",
                size: "sm",
                color: "#888888",
                flex: 2,
              },
              {
                type: "text",
                text: `${data.remaining} ${data.unit}`,
                size: "sm",
                color: data.remaining <= 5 ? "#ef4444" : "#374151",
                flex: 4,
              },
            ],
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: "ผู้เบิก",
                size: "sm",
                color: "#888888",
                flex: 2,
              },
              { type: "text", text: data.userName, size: "sm", flex: 4 },
            ],
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        contents: [
          {
            type: "button",
            action: { type: "message", label: "🏠 กลับเมนูหลัก", text: "เมนู" },
            style: "primary",
            color: themeColor,
            height: "sm",
          },
        ],
      },
    },
  };
}

/* ============================================================
   สร้าง QR URL สำหรับ print ออกมาติดชิ้นงาน
   เรียกจาก Web Dashboard เพื่อ generate QR URL
============================================================ */
function getQRFastTrackUrl(itemCode) {
  const settings = getSettings();
  const botId = settings.lineOaId || "";
  if (!botId) return itemCode; // fallback เป็น itemCode เดิม
  // URL ที่เมื่อสแกนแล้วจะเปิด LINE แล้วส่งข้อความ SCAN:itemCode เข้า Bot
  return `https://line.me/R/oaMessage/${botId}/?text=SCAN%3A${encodeURIComponent(itemCode)}`;
}

let _cachedUsers = null;
function getUser(id) {
  if (!_cachedUsers) {
    _cachedUsers = sheet("Users").getDataRange().getValues().slice(1);
  }
  const idStr = String(id).trim();
  // จับคู่ตาม userId หลัก (คอลัมน์ A) ก่อน
  let r = _cachedUsers.find((row) => String(row[0]).trim() === idStr);
  // ถ้าไม่เจอ ลองจับคู่กับ lineId2 (คอลัมน์ J) — กรณีแอดมินทักมาจาก LINE สำรอง
  if (!r) {
    r = _cachedUsers.find(
      (row) => row[9] && String(row[9]).trim() === idStr,
    );
  }
  if (r) {
    return { userId: r[0], name: r[1], role: r[2] };
  }
  return null;
}

function registerUser(id, name) {
  sheet("Users").appendRow([id, name, "pending"]);
  _writeAudit(
    "REGISTER",
    `ลงทะเบียนใหม่: ${name}`,
    name,
    id,
    "pending",
    "LINE",
  );
  notifyAdmins(id, name);
}

function notifyAdmins(uid, uname) {
  const settings = getSettings();
  const tColor = settings.themeColor || THEME_COLOR;
  const flex = {
    type: "flex",
    altText: "👤 มีคำขอสมัครสมาชิกใหม่",
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "👥 คำขอลงทะเบียนสมาชิก",
            weight: "bold",
            color: "#FFFFFF",
            size: "md",
          },
        ],
        backgroundColor: tColor,
        paddingAll: "lg",
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        paddingAll: "lg",
        contents: [
          {
            type: "text",
            text: "รายละเอียดผู้สมัคร",
            weight: "bold",
            size: "sm",
            color: "#888888",
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "xs",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "ชื่อผู้ใช้",
                    size: "sm",
                    color: "#666666",
                    flex: 3,
                  },
                  {
                    type: "text",
                    text: uname,
                    size: "sm",
                    color: "#111111",
                    weight: "bold",
                    flex: 7,
                    wrap: true,
                  },
                ],
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "สถานะ",
                    size: "sm",
                    color: "#666666",
                    flex: 3,
                  },
                  {
                    type: "text",
                    text: "⏳ รอการอนุมัติสิทธิ์",
                    size: "sm",
                    color: "#F39C12",
                    weight: "bold",
                    flex: 7,
                  },
                ],
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "text",
                    text: "วันเวลา",
                    size: "sm",
                    color: "#666666",
                    flex: 3,
                  },
                  {
                    type: "text",
                    text: formatThaiDateTime(new Date()),
                    size: "sm",
                    color: "#666666",
                    flex: 7,
                  },
                ],
              },
            ],
          },
        ],
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "md",
        paddingAll: "lg",
        contents: [
          {
            type: "button",
            action: {
              type: "postback",
              label: "❌ ปฏิเสธ",
              data: "reject:" + uid,
              displayText: "❌ ปฏิเสธการลงทะเบียน",
            },
            style: "secondary",
            color: COLOR_DANGER,
          },
          {
            type: "button",
            action: {
              type: "postback",
              label: "✅ อนุมัติ",
              data: "approve:" + uid,
              displayText: "✅ อนุมัติการลงทะเบียน",
            },
            style: "primary",
            color: COLOR_SUCCESS,
          },
        ],
      },
    },
  };
  const allUsers = sheet("Users").getDataRange().getValues().slice(1);
  const admins = allUsers.filter((r) => r[2] === "admin");
  _pushApprovalToAdmins(admins, [flex]);
}

function updateUserRole(id, role) {
  const sh = sheet("Users");
  const data = sh.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === id) {
      sh.getRange(i + 1, 3).setValue(role);
      _writeAudit(
        "USER_ROLE",
        `เปลี่ยน Role: ${data[i][1]} (${id}) → ${role}`,
        "Admin",
        id,
        "admin",
        "Web",
      );
      break;
    }
  }
}

// กดปุ่มเดียวจากแดชบอร์ด แก้ role ของบัญชีเก่าที่เคยถูกอนุมัติผิดเป็น "user" (ตอนโค้ดยังไม่อัปเดต) ให้กลับเป็น "qr" ให้ถูกต้องอัตโนมัติ ไม่ต้องเข้าไปแก้ในชีตเอง
// ล้างคำขอ เบิก/ยืม ที่ค้างสถานะ "pending" ทั้งหมดในครั้งเดียว (ปฏิเสธทั้งหมด ปล่อยของที่ถูกจองไว้คืนกลับสต็อก)
// ใช้ตอนมีข้อมูลทดสอบค้างเยอะ หรือคำขอเก่าที่ไม่มีใครมาอนุมัติ/ปฏิเสธ
function webClearAllPendingRequests(payload) {
  payload = payload || {};
  const auth = _requireRole(payload.adminUid, ["admin"]);
  if (!auth.ok) return { success: false, error: auth.error };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return {
      success: false,
      error: "ระบบกำลังประมวลผลรายการอื่นอยู่ กรุณาลองใหม่อีกครั้งครับ",
    };
  }
  try {
    const sh = sheet("WebPendingRequests");
    const rows = sh.getDataRange().getValues();
    const adminUser = getUser(payload.adminUid);
    const adminName =
      payload.adminName || (adminUser ? adminUser.name : "Admin");
    let cleared = 0;

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][11]) === "pending") {
        sh.getRange(i + 1, 12).setValue("rejected");
        sh.getRange(i + 1, 13).setValue(getThaiNow());
        sh.getRange(i + 1, 14).setValue(adminName + " (ล้างทั้งหมด)");
        try {
          push(rows[i][2], [
            {
              type: "text",
              text: `❌ คำขอ${rows[i][9]} "${rows[i][5]}" จำนวน ${rows[i][6]} ถูกยกเลิกครับ (ระบบล้างรายการค้าง)`,
            },
          ]);
        } catch (e) {}
        cleared++;
      }
    }

    if (cleared > 0) {
      _writeAudit(
        "CLEAR_ALL_PENDING",
        `ล้างคำขอเบิก/ยืมที่ค้างอยู่ทั้งหมด ${cleared} รายการ`,
        adminName,
        payload.adminUid || "-",
        "admin",
        "Web-Dashboard",
      );
    }
    return { success: true, cleared };
  } catch (e) {
    return { success: false, error: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function webFixLegacyQrRoles(payload) {
  payload = payload || {};
  const auth = _requireRole(payload.adminUid, ["admin"]);
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    const sh = sheet("Users");
    const data = sh.getDataRange().getValues();
    let fixed = 0;
    const fixedNames = [];
    for (let i = 1; i < data.length; i++) {
      const role = String(data[i][2] || "").trim();
      const source = String(data[i][7] || "").trim();
      if (role === "user" && source === "QR-Registration") {
        sh.getRange(i + 1, 3).setValue("qr");
        fixedNames.push(data[i][1]);
        fixed++;
      }
    }
    if (fixed > 0) {
      _writeAudit(
        "FIX_QR_ROLE",
        `แก้ role ที่ผิดพลาดจาก user → qr: ${fixedNames.join(", ")}`,
        payload.adminName || "Admin",
        payload.adminUid || "-",
        "admin",
        "Web-Dashboard",
      );
    }
    return { success: true, fixed, names: fixedNames };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// บันทึกประวัติการพิมพ์ QR/บาร์โค้ด (เรียกจากแดชบอร์ดตอนกดพิมพ์)
function webSavePrintLog(records) {
  try {
    if (!records || !records.length) return { success: true };
    const sh = sheet("PrintLogs");
    const now = new Date();
    const rows = records.map((r) => [
      "PL" + Date.now() + Math.floor(Math.random() * 10000),
      now,
      r.itemCode || "",
      r.itemName || "",
      r.type || "",
      r.userName || "",
      r.userId || "",
    ]);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(
      rows,
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ดึงประวัติการพิมพ์ล่าสุด (เรียงใหม่สุดก่อน)
function webGetPrintLogs(limit) {
  try {
    limit = Number(limit) || 200;
    const rows = sheet("PrintLogs").getDataRange().getValues().slice(1);
    const logs = rows
      .map((r) => ({
        id: r[0],
        printedAt: r[1] ? new Date(r[1]).toLocaleString("th-TH") : "-",
        itemCode: r[2],
        itemName: r[3],
        type: r[4],
        userName: r[5],
        userId: r[6],
      }))
      .reverse()
      .slice(0, limit);
    return { success: true, logs };
  } catch (e) {
    return { success: false, error: e.toString(), logs: [] };
  }
}

function getItemInfo(q, prioritySheet) {
  const s = (sn) => {
    const rows = sheet(sn).getDataRange().getValues().slice(1);
    let r = rows.find(
      (row) =>
        String(row[0]).trim() === String(q).trim() ||
        String(row[1]).trim() === String(q).trim(),
    );
    if (r) {
      return {
        code: r[0],
        name: r[1],
        category: r[2],
        unit: r[3],
        min: Number(r[4] || 0),
        stock: Number(r[5] || 0),
        sheet: sn,
      };
    }
    return null;
  };
  if (prioritySheet) {
    const f = s(prioritySheet);
    if (f) {
      return f;
    }
  }
  const itemFound = s("Items");
  if (itemFound) return itemFound;
  const toolFound = s("Tools");
  if (toolFound) return toolFound;
  return {
    code: null,
    name: "Unknown",
    category: "-",
    stock: 0,
    unit: "หน่วย",
    min: 0,
  };
}

function updateStock(c, q, m, userName = "System", remark = "", logTime = null) {
  const info = getItemInfo(c);
  if (!info.sheet) {
    throw "Not found";
  }
  const sh = sheet(info.sheet);
  const rows = sh.getDataRange().getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(c).trim()) {
      let isMinus = m === "เบิก" || m === "ยืม" || m === "แจ้งชำรุด";
      let ns = 0;
      if (m === "ปรับยอด") {
        ns = Number(rows[i][5]) + q;
      } else if (isMinus) {
        ns = Number(rows[i][5]) - q;
      } else {
        ns = Number(rows[i][5]) + q;
      }
      if (ns < 0) {
        throw "Stock ไม่พอ";
      }
      sh.getRange(i + 1, 6).setValue(ns);
      const checkMinCondition = isMinus || (m === "ปรับยอด" && q < 0);
      if (checkMinCondition && ns <= Number(rows[i][4] || 0)) {
        notifyLowStock({ name: rows[i][1], stock: ns, unit: rows[i][3] });
      }
      const sign = m === "ปรับยอด" ? (q > 0 ? "+" : "") : isMinus ? "-" : "+";
      const changeStr = sign + q;
      sheet("Logs").appendRow([
        logTime instanceof Date ? logTime : new Date(),
        c,
        rows[i][1],
        changeStr,
        ns,
        "LINE",
        m,
        userName,
        remark,
      ]);

      // ✅ AuditLog — บันทึกทุก action ที่กระทบสต็อก
      _writeAudit(
        m, // type: เบิก / ยืม / คืน / รับเข้า / ปรับยอด
        `[${c}] ${rows[i][1]} ${changeStr} → คงเหลือ ${ns}${remark ? " | หมายเหตุ: " + remark : ""}`,
        userName,
        "-",
        "-",
        "LINE",
      );
      break;
    }
  }
}

function notifyLowStock(item) {
  const users = sheet("Users").getDataRange().getValues().slice(1);
  const admins = users.filter((r) => r[2] === "admin");
  const primaryToken = getPrimaryToken();
  for (let i = 0; i < admins.length; i++) {
    const a = admins[i];
    try {
      push(
        a[0],
        [
          {
            type: "text",
            text: `⚠️ ของใกล้หมด!\n📦 ${item.name} เหลือ: ${item.stock}`,
          },
        ],
        primaryToken,
      );
    } catch (e) {
      // Ignore push error
    }
  }
}

function lineItem(l, v, c = "#555555", w = "regular") {
  return {
    type: "box",
    layout: "baseline",
    contents: [
      { type: "text", text: l, color: "#aaaaaa", flex: 2 },
      { type: "text", text: String(v), color: c, flex: 5, weight: w },
    ],
  };
}

function cacheSet(u, k, v) {
  CacheService.getScriptCache().put(u + "_" + k, String(v), 21600);
}

function cacheGet(u, k) {
  const v = CacheService.getScriptCache().get(u + "_" + k);
  if (k === "qty" && v) {
    return Number(v);
  }
  return v;
}

function clearItemData(u) {
  CacheService.getScriptCache().removeAll([
    u + "_item",
    u + "_qty",
    u + "_image",
    u + "_return_req_id",
  ]);
}

function clearSession(u) {
  CacheService.getScriptCache().removeAll([
    u + "_mode",
    u + "_machine",
    u + "_item",
    u + "_qty",
    u + "_image",
    u + "_newItemStep",
    u + "_newItemData",
    u + "_return_req_id",
  ]);
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sendDashboardFlex(token, uid, settings) {
  let url = ScriptApp.getService().getUrl();
  if (!url) {
    return reply(token, "⚠️ ยังไม่ได้ Deploy Web");
  }
  const separator = url.includes("?") ? "&" : "?";
  const fullUrl = url + separator + "uid=" + uid;
  const tColor = settings.themeColor || THEME_COLOR;
  replyFlex(token, {
    type: "flex",
    altText: "Dashboard",
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "📊 Dashboard",
            weight: "bold",
            color: "#FFFFFF",
          },
        ],
        backgroundColor: tColor,
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            action: { type: "uri", label: "🌐 เปิดเว็บ", uri: fullUrl },
            style: "primary",
            color: tColor,
          },
        ],
      },
    },
  });
}

function sendHistory(token, type) {
  const rows = sheet("Logs").getDataRange().getValues().slice(1).reverse();
  const filteredRows = rows.filter((r) => {
    let act = String(r[6]).trim();
    if (type === "Stock") {
      const itemsData = sheet("Items").getDataRange().getValues();
      const inItems = itemsData.some(
        (i) => String(i[0]).trim() === String(r[1]).trim(),
      );
      return (
        ["เบิก", "รับเข้า", "New Item"].includes(act) ||
        (act === "ปรับยอด" && inItems)
      );
    } else {
      const toolsData = sheet("Tools").getDataRange().getValues();
      const inTools = toolsData.some(
        (i) => String(i[0]).trim() === String(r[1]).trim(),
      );
      return (
        ["ยืม", "คืน", "ซ่อมแซมแล้ว", "แจ้งชำรุด"].includes(act) ||
        (act === "ปรับยอด" && inTools)
      );
    }
  });
  const f = filteredRows.slice(0, 10);
  if (f.length === 0) {
    return reply(token, "📭 ไม่มีประวัติ");
  }
  let msg = `📜 10 ประวัติล่าสุด\n`;
  f.forEach((r, i) => {
    msg += `${i + 1}. [${formatDate(r[0])}] ${r[6]}\n   📦 ${r[2]} (${r[3]})\n   👤 ${r[7]}\n`;
  });
  reply(token, msg);
}

// ฟังก์ชันดึงสรุปรายเดือน (ให้ไปตั้ง Trigger เป็น "ทุกเดือน" วันที่ 1)
function monthlyExportTask() {
  try {
    const settings = getSettings();
    const ss = getActiveSpreadsheetInstance();
    let summary = "📊 สรุปข้อมูลคลังสินค้าประจำเดือน\n\n";
    summary +=
      "- คลังอะไหล่: " +
      (ss.getSheetByName("Items").getLastRow() - 1) +
      " รายการ\n";
    summary +=
      "- เครื่องมือ: " +
      (ss.getSheetByName("Tools").getLastRow() - 1) +
      " รายการ\n";
    summary +=
      "- การเคลื่อนไหว: " +
      (ss.getSheetByName("Logs").getLastRow() - 1) +
      " รายการ\n";
    const backupData = JSON.stringify(webGetBackupData().data);
    const fName = `AutoBackup_CFactory_${new Date().toISOString().split("T")[0]}.json`;
    const f = getSubFolder(
      DriveApp.getFolderById(FOLDER_ID),
      "Monthly_Backups",
    ).createFile(fName, backupData, MimeType.PLAIN_TEXT);
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    summary += `\n📁 ไฟล์สำรองข้อมูล: ${f.getUrl()}`;
    // แจ้งเตือนเข้าไลน์แอดมินทุกคนผ่านบอท
    notifyAdminsText(summary);
  } catch (e) {
    console.error("Export Task Error: " + e);
  }
}

// ฟังก์ชันสรุปของใกล้หมด (ให้ไปตั้ง Trigger เป็น "ทุกวัน" ตอนเช้า)
function dailyDigestTask() {
  try {
    const settings = getSettings();
    const ss = getActiveSpreadsheetInstance();
    const items = ss
      .getSheetByName("Items")
      .getDataRange()
      .getValues()
      .slice(1);
    const tools = ss
      .getSheetByName("Tools")
      .getDataRange()
      .getValues()
      .slice(1);
    let lowItems = items.filter(
      (r) => Number(r[5]) <= Number(r[4]) && String(r[0]).trim() !== "",
    );
    let lowTools = tools.filter(
      (r) => Number(r[5]) <= Number(r[4]) && String(r[0]).trim() !== "",
    );
    if (lowItems.length > 0 || lowTools.length > 0) {
      let msg = "\n⚠️ รายการสินค้าใกล้หมดประจำวัน:\n";
      lowItems.forEach((i) => (msg += `- ${i[1]} (เหลือ ${i[5]})\n`));
      lowTools.forEach((i) => (msg += `- ${i[1]} (เหลือ ${i[5]})\n`));
      notifyAdminsText(msg);
    }
  } catch (e) {
    console.error("Daily Digest Task Error: " + e);
  }
}

// ตั้ง Time-driven Trigger รายชั่วโมง (Apps Script > Triggers > Add Trigger > autoBackupTask > Time-driven > Hour timer)
// ฟังก์ชันนี้จะเช็คเองว่าตรงกับ "เวลา Backup" ที่ตั้งไว้ในหน้าเว็บหรือไม่ (เทียบเฉพาะชั่วโมง เผื่อ Trigger คลาดเคลื่อนไม่กี่นาที)
function autoBackupTask() {
  try {
    const settings = getSettings();
    if (!settings.autoBackupEnabled) return;

    const tzOffset = 7 * 60 * 60 * 1000;
    const now = new Date(new Date().getTime() + tzOffset);
    const currentHour = now.getUTCHours();
    const targetHour = Number(String(settings.autoBackupTime || "23:00").split(":")[0]);
    if (currentHour !== targetHour) return; // ยังไม่ถึงชั่วโมงที่ตั้งไว้

    const ss = getActiveSpreadsheetInstance();
    const url =
      "https://docs.google.com/spreadsheets/d/" + ss.getId() + "/export?format=xlsx";
    const token = ScriptApp.getOAuthToken();
    const response = UrlFetchApp.fetch(url, {
      headers: { Authorization: "Bearer " + token },
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) {
      console.error("Auto backup export failed: " + response.getResponseCode());
      return;
    }
    const dateStr = Utilities.formatDate(now, "GMT", "yyyyMMdd");
    const blob = response
      .getBlob()
      .setName(ss.getName() + "_backup_" + dateStr + ".xlsx");

    const email = String(settings.autoBackupEmail || "").trim();
    if (email) {
      MailApp.sendEmail({
        to: email,
        subject: "📦 Backup ประจำวัน - " + ss.getName() + " (" + dateStr + ")",
        body: "ไฟล์ Backup ฐานข้อมูลประจำวันที่ " + dateStr + " แนบมาพร้อมอีเมลนี้ครับ",
        attachments: [blob],
      });
    }
    _writeAudit("BACKUP", "สร้าง Backup อัตโนมัติสำเร็จ (" + dateStr + ")", "System", "-", "-", "Trigger");
  } catch (e) {
    console.error("Auto Backup Task Error: " + e);
  }
}
// =====================================================================
// เพิ่มฟังก์ชันใหม่สำหรับระบบ "ตะกร้าสินค้า" (ไม่กระทบระบบเดิม)
// =====================================================================

// รวมจำนวนของที่ถูก "กันไว้" จากคำขอเบิก/ยืมที่ยังรออนุมัติอยู่ทั้งหมด (อ่านชีตครั้งเดียวต่อการทำรายการ 1 ครั้ง ไม่ใช่ต่อ 1 ชิ้นในตะกร้า)
function _buildReservedQtyMap() {
  const map = {};
  try {
    const rows = sheet("WebPendingRequests")
      .getDataRange()
      .getValues()
      .slice(1);
    rows.forEach((r) => {
      if (String(r[11]) === "pending") {
        const code = String(r[4]).trim();
        map[code] = (map[code] || 0) + (Number(r[6]) || 0);
      }
    });
  } catch (e) {
    /* ignore */
  }
  return map;
}

// รวมคำขอเบิก/ยืมทุกชิ้นในตะกร้าเดียวกัน ไว้เป็นการ์ด Carousel เดียว ต่อการ push 1 ครั้ง/แอดมิน
// (เดิมยิง push แยกทุกชิ้น×ทุกแอดมิน ทำให้ตะกร้าหลายชิ้นทำรายการช้ามาก เพราะ UrlFetchApp แต่ละครั้งกินเวลา)
function _buildPendingCarouselMessages(items, settings) {
  const bubbles = items.map((it) => {
    const tColor =
      it.type === "ยืม" ? "#E67E22" : settings.themeColor || THEME_COLOR;
    const label = it.type === "ยืม" ? "🛠️ คำขอยืม" : "📤 คำขอเบิก";
    const bodyContents = [
      { type: "text", text: label, weight: "bold", size: "sm", color: tColor },
      {
        type: "text",
        text: it.itemInfo.name,
        wrap: true,
        weight: "bold",
        size: "sm",
        margin: "md",
      },
      {
        type: "text",
        text: `ผู้ขอ: ${it.userName}`,
        size: "xxs",
        color: "#555555",
      },
      {
        type: "text",
        text: `จำนวน: ${it.qty} ${it.itemInfo.unit || ""}`,
        size: "xxs",
        color: "#111111",
        weight: "bold",
      },
      {
        type: "text",
        text: `รหัส: ${it.itemInfo.code}`,
        size: "xxs",
        color: "#888888",
      },
    ];
    if (it.remark)
      bodyContents.push({
        type: "text",
        text: `หมายเหตุ: ${it.remark}`,
        size: "xxs",
        color: "#e67e22",
        wrap: true,
      });

    return {
      type: "bubble",
      size: "micro",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "xs",
        paddingAll: "md",
        contents: bodyContents,
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "xs",
        paddingAll: "md",
        contents: [
          {
            type: "button",
            action: {
              type: "postback",
              label: "✅ อนุมัติ",
              data: "webtx_approve:" + it.reqId,
              displayText: "✅ อนุมัติ",
            },
            style: "primary",
            color: COLOR_SUCCESS,
            height: "sm",
          },
          {
            type: "button",
            action: {
              type: "postback",
              label: "❌ ปฏิเสธ",
              data: "webtx_reject:" + it.reqId,
              displayText: "❌ ปฏิเสธ",
            },
            style: "secondary",
            color: COLOR_DANGER,
            height: "sm",
          },
        ],
      },
    };
  });

  // LINE จำกัดไม่เกิน 12 บับเบิล/carousel และไม่เกิน 5 ข้อความ/push — แบ่งเป็นชุดละ 10 บับเบิลให้ชัวร์
  const messages = [];
  for (let i = 0; i < bubbles.length && messages.length < 5; i += 10) {
    messages.push({
      type: "flex",
      altText: `มีคำขอเบิก/ยืมใหม่ ${bubbles.length} รายการ รออนุมัติ`,
      contents: { type: "carousel", contents: bubbles.slice(i, i + 10) },
    });
  }
  return messages;
}

function webBatchTransaction(payloads, signatureBase64) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000))
    return { success: false, error: "คิวระบบเต็ม กรุณาลองใหม่อีกครั้ง" };
  try {
    ensureSignatureColumns();
    const errors = [];
    let successCount = 0;
    let pendingCount = 0;
    const settings = getSettings();

    // บันทึกลายเซ็นลง Google Drive
    let signatureUrl = "";
    if (signatureBase64 && signatureBase64.trim() !== "") {
      try {
        const userName = payloads.length > 0 ? payloads[0].user : "Web_User";
        const fileName = "SIG_" + String(userName).replace(/[^a-zA-Z0-9ก-๙]/g, "_") + "_" + Date.now() + ".png";
        const bytes = Utilities.base64Decode(signatureBase64);
        const blob = Utilities.newBlob(bytes, "image/png", fileName);
        
        const parentFolder = DriveApp.getFolderById(FOLDER_ID);
        const sigFolder = getSubFolder(parentFolder, "Images_Signatures");
        const file = sigFolder.createFile(blob);
        try {
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (e) {}
        signatureUrl = "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w400";
      } catch (err) {
        errors.push("ไม่สามารถบันทึกลายเซ็นลงไดรฟ์ได้: " + err.toString());
      }
    }

    // โหลดข้อมูลที่ต้องใช้ซ้ำไว้ล่วงหน้าครั้งเดียว แทนการอ่านทั้งชีตใหม่ทุกรายการในตะกร้า (ตัวการหลักที่ทำให้ทำรายการช้า)
    const itemsData = sheet("Items").getDataRange().getValues().slice(1);
    const toolsData = sheet("Tools").getDataRange().getValues().slice(1);
    const rowToInfo = (r, sn) => ({
      code: r[0],
      name: r[1],
      category: r[2],
      unit: r[3],
      min: Number(r[4] || 0),
      stock: Number(r[5] || 0),
      sheet: sn,
    });
    const findItem = (code) => {
      let r = itemsData.find(
        (row) =>
          String(row[0]).trim() === String(code).trim() ||
          String(row[1]).trim() === String(code).trim(),
      );
      if (r) return rowToInfo(r, "Items");
      r = toolsData.find(
        (row) =>
          String(row[0]).trim() === String(code).trim() ||
          String(row[1]).trim() === String(code).trim(),
      );
      if (r) return rowToInfo(r, "Tools");
      return null;
    };
    const reservedMap = _buildReservedQtyMap();

    const newPendingRows = [];
    const pendingForNotify = [];

    // วนลูปบันทึกข้อมูลทีละรายการในตะกร้า
    for (let i = 0; i < payloads.length; i++) {
      const p = payloads[i];
      const code = p.code;
      const qty = Number(p.qty);
      const type = p.type; // "เบิก", "รับเข้า", "ยืม"
      const user = p.user;
      const uid = p.uid || "WEB_SCANNER";
      const remark = p.remark;

      if (!Number.isInteger(qty) || qty < 1) {
        errors.push(`จำนวนไม่ถูกต้องสำหรับรหัส ${code}`);
        continue;
      }

      // 1. ดึงข้อมูลสินค้า (จาก cache ที่โหลดไว้แล้ว ไม่อ่านชีตซ้ำ)
      const itemInfo = findItem(code);
      if (!itemInfo) {
        errors.push(`ไม่พบรหัส ${code}`);
        continue;
      }

      // 2. แยกตามประเภทการทำรายการ
      if (type === "เบิก" || type === "ยืม") {
        // "เบิก" และ "ยืม" ต้องรอแอดมินอนุมัติในไลน์ก่อนถึงจะตัดสต็อกจริง
        // ระหว่างรอ ของจะถูก "กันไว้" ก่อน กันคนอื่นเบิกซ้ำเกินของที่เหลือจริง
        const codeKey = String(code).trim();
        const reserved = reservedMap[codeKey] || 0;
        const available = itemInfo.stock - reserved;
        if (available < qty) {
          errors.push(
            `สต็อกไม่พอสำหรับ ${itemInfo.name} (เหลือว่างจริง ${available} ${itemInfo.unit || ""} เนื่องจากมีรายการรออนุมัติกันไว้อยู่)`,
          );
          continue;
        }
        reservedMap[codeKey] = reserved + qty; // กันไม่ให้รายการถัดไปในตะกร้าเดียวกันเบิกซ้ำเกิน

        const reqId = "WT" + Date.now() + i;
        newPendingRows.push([
          reqId,
          new Date(),
          uid,
          user,
          code,
          itemInfo.name,
          qty,
          itemInfo.category || "-",
          itemInfo.unit || "",
          type,
          remark || "",
          "pending",
          "",
          "",
          signatureUrl, // คอลัมน์ที่ 15
        ]);
        pendingForNotify.push({
          reqId,
          type,
          userName: user,
          itemInfo,
          qty,
          remark,
        });
        pendingCount++;
      } else if (type === "รับเข้า") {
        // รับเข้า ไม่มีความเสี่ยงเรื่องสต็อกไม่พอ ให้ทำรายการทันทีเหมือนเดิม
        updateStock(code, qty, type, user, remark || "");

        const transId = "RC" + Date.now() + i;
        sheet("Receives").appendRow([
          transId,
          new Date(),
          uid,
          user,
          type,
          code,
          itemInfo.name,
          qty,
          itemInfo.category,
          "Web Scanner",
          "approved",
        ]);
        successCount++;
      } else {
        errors.push(`ไม่รู้จักประเภทรายการ: ${type}`);
      }
    }

    // เขียนคำขอที่รออนุมัติทั้งหมดลงชีตในครั้งเดียว + แจ้งเตือนแอดมินรวมเป็น push เดียว/คน
    if (newPendingRows.length > 0) {
      const sh = sheet("WebPendingRequests");
      sh.getRange(
        sh.getLastRow() + 1,
        1,
        newPendingRows.length,
        newPendingRows[0].length,
      ).setValues(newPendingRows);

      try {
        const messages = _buildPendingCarouselMessages(
          pendingForNotify,
          settings,
        );
        const admins = sheet("Users")
          .getDataRange()
          .getValues()
          .slice(1)
          .filter((r) => r[2] === "admin");
        _pushApprovalToAdmins(admins, messages);
      } catch (e) {
        // ไม่ให้ error ตรงนี้ทำให้การบันทึกคำขอล้มเหลว แต่ต้อง log ไว้ ไม่งั้นจะไม่รู้เลยว่าทำไมแจ้งเตือนไม่ขึ้น
        console.error("❌ ส่งแจ้งเตือนอนุมัติไม่สำเร็จ: " + e.toString());
      }
    }

    // 3. ตรวจสอบผลลัพธ์
    if (errors.length > 0 && successCount === 0 && pendingCount === 0) {
      return { success: false, error: errors.join(", ") };
    } else if (errors.length > 0) {
      // สำเร็จบางส่วน
      return {
        success: true,
        successCount,
        pendingCount,
        error: "สำเร็จบางส่วน แต่มีข้อผิดพลาด: " + errors.join(", "),
      };
    }

    return { success: true, successCount, pendingCount };
  } catch (error) {
    return { success: false, error: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

// ═══════════════════════════════════════════════════
//  ARCHIVE MONTH — ปิดเดือน / ดูรายการ / กู้คืน
// ═══════════════════════════════════════════════════

// ดึงประวัติรายการ "ทั้งหมด" ของสินค้าชิ้นเดียว โดยค้นทั้ง Logs ปัจจุบัน + ทุกชีต Archive_*
// ใช้แยกต่างหากจาก allData.history (ที่จำกัด 500 แถวล่าสุดของ Logs) เพื่อไม่ให้กระทบ dashboard เดิม
function webGetFullItemHistory(itemCode) {
  try {
    const code = String(itemCode || "").trim();
    if (!code) return { success: false, error: "ไม่พบรหัสสินค้า", history: [] };

    const ss = getActiveSpreadsheetInstance();

    // หา unit ของสินค้าจาก Items หรือ Tools (ไว้แสดงในตาราง เหมือนของเดิม)
    let unit = "";
    ["Items", "Tools"].some((name) => {
      const sh = ss.getSheetByName(name);
      if (!sh || sh.getLastRow() < 2) return false;
      const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
      const found = rows.find((r) => String(r[0] || "").trim() === code);
      if (found) {
        unit = String(found[3] || "").trim();
        return true;
      }
      return false;
    });

    // เก็บรายชื่อชีตที่ต้องอ่าน: Logs ปัจจุบัน + Archive_* ทั้งหมด
    const sheetsToScan = [];
    const logSh = ss.getSheetByName("Logs");
    if (logSh) sheetsToScan.push(logSh);
    ss.getSheets().forEach((sh) => {
      if (sh.getName().indexOf("Archive_") === 0) sheetsToScan.push(sh);
    });

    let history = [];
    sheetsToScan.forEach((sh) => {
      if (sh.getLastRow() < 2) return;
      const numCols = Math.max(8, sh.getLastColumn());
      const rows = sh.getRange(2, 1, sh.getLastRow() - 1, numCols).getValues();
      rows.forEach((r) => {
        if (String(r[1] || "").trim() !== code) return; // คอลัมน์ B = code
        history.push({
          time: formatDate(r[0]),
          rawTime: r[0] instanceof Date ? r[0].getTime() : 0,
          code: String(r[1] || "").trim(),
          itemName: String(r[2] || "").trim(),
          amount: String(r[3] || "").trim(),
          balance: String(r[4] || "").trim(),
          action: String(r[6] || "").trim(),
          user: r[7] ? String(r[7]).trim() : "ไม่ระบุ",
          remark: r[8] ? String(r[8]).trim() : "",
          unit: unit,
        });
      });
    });

    history.sort((a, b) => b.rawTime - a.rawTime);
    history.forEach((h) => delete h.rawTime);

    return { success: true, history: history };
  } catch (e) {
    return { success: false, error: e.toString(), history: [] };
  }
}

// ═══════════════════════════════════════════════════
//  STOCK TAKE — นับสต็อกประจำเดือน (สิ้นเดือน) + รายงานครึ่งปี
//  Sheet ใหม่ 2 ชีต: StockTakeSessions, StockTakeRecords (สร้างอัตโนมัติ ไม่กระทบชีตเดิม)
// ═══════════════════════════════════════════════════

const STOCKTAKE_SESSION_HEADERS = [
  "sessionId",
  "year",
  "month",
  "status",
  "startedBy",
  "startedAt",
  "closedBy",
  "closedAt",
  "totalItems",
  "countedItems",
];
const STOCKTAKE_RECORD_HEADERS = [
  "sessionId",
  "itemCode",
  "itemName",
  "systemStock",
  "countedQty",
  "diff",
  "unit",
  "countedBy",
  "role",
  "source",
  "timestamp",
  "resolved",
  "resolvedRemark",
  "assignedUserId",
  "assignedUserName",
  "assignedAt",
  "assignedRemark",
  "assignedQty",
];

function _stockTakeSheet(name, headers) {
  const ss = getActiveSpreadsheetInstance();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

// เผื่อชีท StockTakeRecords ถูกสร้างไว้ก่อนหน้านี้ด้วยคอลัมน์ชุดเก่า (13 คอลัมน์)
// ให้เติมคอลัมน์ใหม่ (มอบหมายให้ user แจ้งเตือน) ต่อท้ายให้ครบโดยไม่กระทบข้อมูลเดิม
function _ensureStockTakeRecordColumns(sh) {
  const lastCol = sh.getLastColumn();
  if (lastCol < STOCKTAKE_RECORD_HEADERS.length) {
    sh.getRange(
      1,
      lastCol + 1,
      1,
      STOCKTAKE_RECORD_HEADERS.length - lastCol,
    ).setValues([STOCKTAKE_RECORD_HEADERS.slice(lastCol)]);
  }
  return sh;
}

function _currentStockTakeSessionId() {
  const d = new Date();
  return (
    "ST_" + d.getFullYear() + "_" + String(d.getMonth() + 1).padStart(2, "0")
  );
}

function _canStockTake(role) {
  return role === "admin" || role === "staff";
}

// เปิด/ดึงรอบนับของเดือนปัจจุบัน พร้อมรายการสินค้าทั้งหมด + สถานะว่านับไปหรือยัง
function webGetStockTakeProgress(payload) {
  payload = payload || {};
  try {
    const role = payload.role || "";
    if (!_canStockTake(role))
      return {
        success: false,
        error: "ไม่มีสิทธิ์นับสต็อก (ต้องเป็น admin หรือ staff)",
      };

    const sessionId = payload.sessionId || _currentStockTakeSessionId();
    const sessSh = _stockTakeSheet(
      "StockTakeSessions",
      STOCKTAKE_SESSION_HEADERS,
    );
    const recSh = _stockTakeSheet("StockTakeRecords", STOCKTAKE_RECORD_HEADERS);

    let sessData = sessSh.getDataRange().getValues();
    let sIdx = -1;
    for (let i = 1; i < sessData.length; i++) {
      if (String(sessData[i][0]) === sessionId) {
        sIdx = i;
        break;
      }
    }
    const now = new Date();
    if (sIdx === -1) {

      sessSh.appendRow([
        sessionId,
        now.getFullYear(),
        now.getMonth() + 1,
        "open",
        payload.userName || "-",
        now,
        "",
        "",
        0,
        0,
      ]);
      sessData = sessSh.getDataRange().getValues();
      sIdx = sessData.length - 1;
    }
    const sessRow = sessData[sIdx];

    const ss = getActiveSpreadsheetInstance();
    const items = [];
    ["Items", "Tools"].forEach((name) => {
      const sh = ss.getSheetByName(name);
      if (!sh || sh.getLastRow() < 2) return;
      const rows = sh
        .getRange(2, 1, sh.getLastRow() - 1, Math.max(6, sh.getLastColumn()))
        .getValues();
      rows.forEach((r) => {
        const code = String(r[0] || "").trim();
        if (!code) return;
        items.push({
          code: code,
          name: String(r[1] || "").trim(),
          unit: String(r[3] || "").trim(),
          systemStock: Number(r[5] || 0),
        });
      });
    });

    const countedMap = {};
    if (recSh.getLastRow() > 1) {
      const recRows = recSh
        .getRange(2, 1, recSh.getLastRow() - 1, STOCKTAKE_RECORD_HEADERS.length)
        .getValues();
      recRows.forEach((r) => {
        if (String(r[0]) !== sessionId) return;
        countedMap[String(r[1]).trim()] = {
          countedQty: Number(r[4]),
          diff: Number(r[5]),
          countedBy: r[7],
          source: r[9],
          timestamp:
            r[10] instanceof Date ? formatDate(r[10]) : String(r[10] || ""),
        };
      });
    }

    const itemsWithStatus = items.map((it) => {
      const c = countedMap[it.code];
      return Object.assign({}, it, {
        counted: !!c,
        countedQty: c ? c.countedQty : null,
        diff: c ? c.diff : null,
        countedBy: c ? c.countedBy : null,
        countedAt: c ? c.timestamp : null,
      });
    });

    const countedItems = itemsWithStatus.filter((i) => i.counted).length;
    sessSh
      .getRange(sIdx + 1, 9, 1, 2)
      .setValues([[items.length, countedItems]]);

    return {
      success: true,
      sessionId: sessionId,
      status: sessRow[3],
      year: sessRow[1],
      month: sessRow[2],
      totalItems: items.length,
      countedItems: countedItems,
      items: itemsWithStatus,
    };
  } catch (e) {
    return { success: false, error: e.toString(), items: [] };
  }
}

// บันทึกยอดนับของสินค้า 1 ชิ้น — ถ้ายอดไม่ตรงกับระบบ จะปรับสต็อกทันที + เขียน Logs
function webSubmitStockCount(payload) {
  payload = payload || {};
  try {
    const role = payload.role || "";
    if (!_canStockTake(role))
      return {
        success: false,
        error: "ไม่มีสิทธิ์นับสต็อก (ต้องเป็น admin หรือ staff)",
      };

    const code = String(payload.itemCode || "").trim();
    const countedQty = Number(payload.countedQty);
    if (!code) return { success: false, error: "ไม่พบรหัสสินค้า" };
    if (isNaN(countedQty) || countedQty < 0)
      return { success: false, error: "จำนวนที่นับไม่ถูกต้อง" };

    const sessionId = payload.sessionId || _currentStockTakeSessionId();

    const info = getItemInfo(code);
    if (!info.sheet) return { success: false, error: "ไม่พบสินค้ารหัสนี้" };
    const sh = sheet(info.sheet);
    const rows = sh.getDataRange().getValues();
    let rIdx = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === code) {
        rIdx = i;
        break;
      }
    }
    if (rIdx === -1) return { success: false, error: "ไม่พบสินค้ารหัสนี้" };

    const systemStock = Number(rows[rIdx][5] || 0);
    const unit = String(rows[rIdx][3] || "").trim();
    const itemName = String(rows[rIdx][1] || "").trim();
    const diff = countedQty - systemStock;

    const recSh = _stockTakeSheet("StockTakeRecords", STOCKTAKE_RECORD_HEADERS);
    const sessSh = _stockTakeSheet(
      "StockTakeSessions",
      STOCKTAKE_SESSION_HEADERS,
    );
    // ให้แน่ใจว่ามีรอบนับของเดือนนี้อยู่แล้ว (เผื่อเรียก submit ก่อน progress)
    const sessData = sessSh.getDataRange().getValues();
    let sExists = false;
    for (let i = 1; i < sessData.length; i++) {
      if (String(sessData[i][0]) === sessionId) {
        sExists = true;
        break;
      }
    }
    if (!sExists) {
      const now0 = new Date();
      sessSh.appendRow([
        sessionId,
        now0.getFullYear(),
        now0.getMonth() + 1,
        "open",
        payload.userName || "-",
        now0,
        "",
        "",
        0,
        0,
      ]);
    }

    // กันนับซ้ำ: ถ้าเคยนับชิ้นนี้ในรอบนี้แล้ว ให้ทับแถวเดิมแทนการเพิ่มแถวใหม่
    let existingRowIdx = -1;
    if (recSh.getLastRow() > 1) {
      const recRows = recSh
        .getRange(2, 1, recSh.getLastRow() - 1, STOCKTAKE_RECORD_HEADERS.length)
        .getValues();
      for (let i = 0; i < recRows.length; i++) {
        if (
          String(recRows[i][0]) === sessionId &&
          String(recRows[i][1]).trim() === code
        ) {
          existingRowIdx = i;
          break;
        }
      }
    }

    const now = new Date();
    const displayUser = payload.userName || "ไม่ระบุ";
    const source = payload.source === "manual" ? "คีย์มือ(แอดมิน)" : "สแกน QR";
    const rowData = [
      sessionId,
      code,
      itemName,
      systemStock,
      countedQty,
      diff,
      unit,
      displayUser,
      role,
      source,
      now,
      false,
      "",
    ];

    if (existingRowIdx > -1) {
      // คงค่า resolved/resolvedRemark เดิมไว้ ถ้าเคยแก้ไขส่วนต่างไปแล้วก่อนหน้านี้ในรอบเดียวกัน
      const prevResolved = recSh
        .getRange(existingRowIdx + 2, 12, 1, 2)
        .getValues()[0];
      if (prevResolved && prevResolved[0]) {
        rowData[11] = prevResolved[0];
        rowData[12] = prevResolved[1];
      }
      recSh
        .getRange(existingRowIdx + 2, 1, 1, STOCKTAKE_RECORD_HEADERS.length)
        .setValues([rowData]);
    } else {
      recSh.appendRow(rowData);
    }

    // มีส่วนต่าง → ปรับยอดจริงในระบบทันที พร้อม log
    if (diff !== 0) {
      const remark =
        "นับสต็อกประจำเดือน " +
        String(sessionId).replace("ST_", "").replace("_", "/") +
        " (" +
        source +
        ")";
      updateStock(code, diff, "ปรับยอด", displayUser + " (นับสต็อก)", remark);
    }

    return {
      success: true,
      diff: diff,
      systemStock: systemStock,
      countedQty: countedQty,
      newStock: systemStock + diff,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ปิดรอบนับ (เฉพาะ admin)
function webGetStockTakeDiffs(payload) {
  payload = payload || {};
  try {
    const role = payload.role || "";
    if (!_canStockTake(role))
      return { success: false, error: "ไม่มีสิทธิ์", diffs: [] };

    const sessionId = payload.sessionId || _currentStockTakeSessionId();
    const recSh = _ensureStockTakeRecordColumns(
      _stockTakeSheet("StockTakeRecords", STOCKTAKE_RECORD_HEADERS),
    );
    const diffs = [];
    if (recSh.getLastRow() > 1) {
      const rows = recSh
        .getRange(2, 1, recSh.getLastRow() - 1, STOCKTAKE_RECORD_HEADERS.length)
        .getValues();
      rows.forEach((r) => {
        if (String(r[0]) !== sessionId) return;
        const diff = Number(r[5]);
        if (diff === 0) return;
        diffs.push({
          itemCode: String(r[1]),
          itemName: String(r[2]),
          systemStock: Number(r[3]),
          countedQty: Number(r[4]),
          diff: diff,
          unit: String(r[6]),
          countedBy: String(r[7]),
          source: String(r[9]),
          timestamp: r[10] instanceof Date ? formatDate(r[10]) : String(r[10] || ""),
          resolved: !!r[11],
          resolvedRemark: String(r[12] || ""),
          assignedUserId: String(r[13] || ""),
          assignedUserName: String(r[14] || ""),
          assignedAt: r[15] instanceof Date ? formatDate(r[15]) : String(r[15] || ""),
          assignedRemark: String(r[16] || ""),
          assignedQty: r[17] ? Number(r[17]) : null,
        });
      });
    }
    return { success: true, diffs: diffs };
  } catch (e) {
    return { success: false, error: e.toString(), diffs: [] };
  }
}

// บันทึก "เบิกย้อนหลัง" เพื่ออธิบายสาเหตุส่วนต่างที่ขาด (ไม่ตัดสต็อกซ้ำ เพราะสต็อกถูกปรับไปแล้วตอนคีย์ยอดนับ)
function webResolveStockDiff(payload) {
  payload = payload || {};
  try {
    const role = payload.role || "";
    if (!_canStockTake(role))
      return { success: false, error: "ไม่มีสิทธิ์" };

    const sessionId = payload.sessionId || _currentStockTakeSessionId();
    const code = String(payload.itemCode || "").trim();
    const qty = Number(payload.qty);
    const remark = String(payload.remark || "").trim();
    if (!code) return { success: false, error: "ไม่พบรหัสสินค้า" };
    if (isNaN(qty) || qty <= 0)
      return { success: false, error: "จำนวนไม่ถูกต้อง" };
    if (!remark) return { success: false, error: "กรุณาระบุเหตุผล" };

    const info = getItemInfo(code);
    if (!info.sheet) return { success: false, error: "ไม่พบสินค้ารหัสนี้" };
    const shItem = sheet(info.sheet);
    const itemRows = shItem.getDataRange().getValues();
    let itemName = code;
    let category = "";
    for (let i = 1; i < itemRows.length; i++) {
      if (String(itemRows[i][0]).trim() === code) {
        itemName = String(itemRows[i][1] || code);
        category = info.sheet === "Tools" ? "เครื่องมือ" : "อะไหล่";
        break;
      }
    }

    const forUserName = String(payload.forUserName || payload.userName || "ไม่ระบุ");
    const forUserUid = String(payload.forUserUid || payload.adminUid || "-");
    const adminName = payload.userName || "ไม่ระบุ";
    const uid = forUserUid;
    const transId = "WD" + new Date().getTime();
    const now = getThaiNow();

    ensureSignatureColumns();
    // บันทึกเป็นรายการเบิกจริง (ย้อนหลัง) ในนามผู้ที่เลือก เพื่ออธิบายสาเหตุส่วนต่าง — ไม่เรียก updateStock ซ้ำ
    // เพราะสต็อกถูกปรับยอดไปแล้วอัตโนมัติตอนคีย์ยอดนับในขั้นตอน webSubmitStockCount
    sheet("Withdraws").appendRow([
      transId,
      now,
      uid,
      forUserName,
      code,
      itemName,
      qty,
      category,
      "",
      "",
      remark + " (เบิกย้อนหลัง จากส่วนต่างนับสต็อก " + sessionId + " — บันทึกโดย " + adminName + ")",
    ]);

    sheet("Logs").appendRow([
      now,
      code,
      itemName,
      `-${qty}`,
      Number(itemRows.find((r) => String(r[0]).trim() === code)[5] || 0),
      "Web-StockTake",
      "เบิก",
      forUserName,
      "เบิกย้อนหลัง: " + remark,
    ]);

    // มาร์ครายการส่วนต่างนี้ว่าอธิบายสาเหตุแล้ว
    const recSh = _stockTakeSheet("StockTakeRecords", STOCKTAKE_RECORD_HEADERS);
    if (recSh.getLastRow() > 1) {
      const rows = recSh
        .getRange(2, 1, recSh.getLastRow() - 1, STOCKTAKE_RECORD_HEADERS.length)
        .getValues();
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i][0]) === sessionId && String(rows[i][1]).trim() === code) {
          recSh.getRange(i + 2, 12, 1, 2).setValues([[true, remark]]);
          break;
        }
      }
    }

    _writeAudit(
      "RETRO_WITHDRAW",
      `เบิกย้อนหลัง [${code}] ${itemName} x${qty} ในนาม ${forUserName} — เหตุผล: ${remark} (บันทึกโดย ${adminName})`,
      adminName,
      payload.adminUid || "-",
      role,
      "Web-StockTake",
    );

    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ดึงรายการเบิกย้อนหลัง (จากส่วนต่างนับสต็อก) ที่บันทึกในนามของ user คนนี้ — ใช้ในหน้า QR
function webGetMyRetroWithdraws(payload) {
  payload = payload || {};
  try {
    const uid = String(payload.uid || payload.userId || "").trim();
    if (!uid) return { success: false, error: "ไม่พบผู้ใช้", items: [] };

    const wdSh = getActiveSpreadsheetInstance().getSheetByName("Withdraws");
    if (!wdSh || wdSh.getLastRow() < 2) return { success: true, items: [] };

    const rows = wdSh
      .getRange(2, 1, wdSh.getLastRow() - 1, 11)
      .getValues();
    const items = [];
    rows.forEach((r) => {
      const remark = String(r[10] || "");
      if (String(r[2]) === uid && remark.indexOf("เบิกย้อนหลัง จากส่วนต่างนับสต็อก") !== -1) {
        items.push({
          transId: String(r[0]),
          date: r[1] instanceof Date ? formatDate(r[1]) : String(r[1]),
          itemCode: String(r[4]),
          itemName: String(r[5]),
          qty: Number(r[6]),
          category: String(r[7]),
          remark: remark,
        });
      }
    });
    items.reverse(); // ล่าสุดก่อน
    return { success: true, items: items };
  } catch (e) {
    return { success: false, error: e.toString(), items: [] };
  }
}

// ดูว่า "ใครเบิกไปใช้" สินค้ารหัสนี้บ้างในช่วงที่ผ่านมา (ให้แอดมินไล่ดูก่อนมอบหมาย/บันทึกเบิกย้อนหลัง)
function webGetItemRecentWithdraws(payload) {
  payload = payload || {};
  try {
    const role = payload.role || "";
    if (!_canStockTake(role))
      return { success: false, error: "ไม่มีสิทธิ์", records: [] };

    const code = String(payload.itemCode || "").trim();
    if (!code) return { success: false, error: "ไม่พบรหัสสินค้า", records: [] };

    const sessionId = payload.sessionId || _currentStockTakeSessionId();
    const sessSh = _stockTakeSheet(
      "StockTakeSessions",
      STOCKTAKE_SESSION_HEADERS,
    );
    let sinceDate = null;
    if (sessSh.getLastRow() > 1) {
      const sessRows = sessSh
        .getRange(2, 1, sessSh.getLastRow() - 1, STOCKTAKE_SESSION_HEADERS.length)
        .getValues();
      for (let i = 0; i < sessRows.length; i++) {
        if (String(sessRows[i][0]) === sessionId) {
          sinceDate = sessRows[i][5] instanceof Date ? sessRows[i][5] : null;
          break;
        }
      }
    }
    if (!sinceDate) {
      sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - 60); // fallback: ย้อนหลัง 60 วัน
    }

    const wdSh = sheet("Withdraws");
    const records = [];
    if (wdSh.getLastRow() > 1) {
      const rows = wdSh
        .getRange(2, 1, wdSh.getLastRow() - 1, Math.max(11, wdSh.getLastColumn()))
        .getValues();
      rows.forEach((r) => {
        if (String(r[4] || "").trim() !== code) return; // itemCode column
        const ts = r[1] instanceof Date ? r[1] : null;
        if (ts && ts < sinceDate) return;
        records.push({
          transId: String(r[0] || ""),
          timestamp: r[1] instanceof Date ? formatDate(r[1]) : String(r[1] || ""),
          userId: String(r[2] || ""),
          userName: String(r[3] || ""),
          qty: Number(r[6] || 0),
          remark: String(r[10] || ""),
        });
      });
    }
    records.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    return { success: true, records: records };
  } catch (e) {
    return { success: false, error: e.toString(), records: [] };
  }
}

// แอดมินมอบหมายให้ user คนใดคนหนึ่งเป็นผู้ยืนยัน "เบิกย้อนหลัง" ด้วยตัวเอง
// จะไปขึ้นแจ้งเตือนตอน user คนนั้น login เข้า QR — ยังไม่ถือว่า resolved จนกว่า user จะยืนยันเอง
function webAssignStockDiffUser(payload) {
  payload = payload || {};
  try {
    const role = payload.role || "";
    if (!_canStockTake(role))
      return { success: false, error: "ไม่มีสิทธิ์" };

    const sessionId = payload.sessionId || _currentStockTakeSessionId();
    const code = String(payload.itemCode || "").trim();
    const qty = Number(payload.qty);
    const targetUserId = String(payload.targetUserId || "").trim();
    const remark = String(payload.remark || "").trim();
    if (!code) return { success: false, error: "ไม่พบรหัสสินค้า" };
    if (isNaN(qty) || qty <= 0) return { success: false, error: "จำนวนไม่ถูกต้อง" };
    if (!targetUserId) return { success: false, error: "กรุณาเลือกผู้ใช้ที่จะมอบหมาย" };

    const usersRows = sheet("Users").getDataRange().getValues().slice(1);
    const targetUser = usersRows.find(
      (r) => String(r[0]).trim() === targetUserId,
    );
    const targetUserName = targetUser ? String(targetUser[1] || targetUserId) : targetUserId;

    const recSh = _ensureStockTakeRecordColumns(
      _stockTakeSheet("StockTakeRecords", STOCKTAKE_RECORD_HEADERS),
    );
    let rIdx = -1;
    if (recSh.getLastRow() > 1) {
      const rows = recSh
        .getRange(2, 1, recSh.getLastRow() - 1, STOCKTAKE_RECORD_HEADERS.length)
        .getValues();
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i][0]) === sessionId && String(rows[i][1]).trim() === code) {
          rIdx = i;
          break;
        }
      }
    }
    if (rIdx === -1) return { success: false, error: "ไม่พบรายการนับสต็อกนี้ในรอบนี้" };

    const now = getThaiNow();
    recSh
      .getRange(rIdx + 2, 14, 1, 5)
      .setValues([[targetUserId, targetUserName, now, remark, qty]]);

    _writeAudit(
      "ASSIGN_RETRO_WITHDRAW",
      `มอบหมายให้ ${targetUserName} ยืนยันเบิกย้อนหลัง [${code}] x${qty} (รอบ ${sessionId})`,
      payload.userName || "admin",
      payload.adminUid || "-",
      role,
      "Web-StockTake",
    );

    return { success: true, targetUserName: targetUserName };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ดึงรายการ "ส่วนต่างที่ถูกมอบหมาย" ให้ user คนนี้ต้องยืนยันเบิกย้อนหลัง (ยังไม่ resolved) — ใช้แจ้งเตือนตอน login QR
function webGetMyPendingRetroWithdraws(payload) {
  payload = payload || {};
  try {
    const userId = String(payload.userId || "").trim();
    if (!userId) return { success: false, error: "ไม่พบ userId", items: [] };

    const recSh = _ensureStockTakeRecordColumns(
      _stockTakeSheet("StockTakeRecords", STOCKTAKE_RECORD_HEADERS),
    );
    const items = [];
    if (recSh.getLastRow() > 1) {
      const rows = recSh
        .getRange(2, 1, recSh.getLastRow() - 1, STOCKTAKE_RECORD_HEADERS.length)
        .getValues();
      rows.forEach((r) => {
        const assignedUserId = String(r[13] || "").trim();
        const resolved = !!r[11];
        if (assignedUserId === userId && !resolved) {
          items.push({
            sessionId: String(r[0]),
            itemCode: String(r[1]),
            itemName: String(r[2]),
            diff: Number(r[5]),
            unit: String(r[6]),
            assignedAt: r[15] instanceof Date ? formatDate(r[15]) : String(r[15] || ""),
            assignedRemark: String(r[16] || ""),
            assignedQty: r[17] ? Number(r[17]) : Math.abs(Number(r[5]) || 0),
          });
        }
      });
    }
    return { success: true, items: items };
  } catch (e) {
    return { success: false, error: e.toString(), items: [] };
  }
}

// ดึงรายการ "เบิก/ยืม" ของผู้ใช้คนนี้ ที่ยังรออนุมัติอยู่ (status = pending)
// ใช้แสดง badge/แจ้งเตือนในหน้า QR ให้ user เห็นว่ายังมีรายการค้างรออนุมัติอยู่กี่รายการ
function webGetMyPendingRequests(payload) {
  payload = payload || {};
  try {
    const userId = String(payload.userId || "").trim();
    if (!userId) return { success: false, error: "ไม่พบ userId", items: [] };

    // โหลดรูปสินค้าจาก Items/Tools มาไว้ใน map ครั้งเดียว เพื่อผูกกับแต่ละคำขอ (ใช้ header lookup แบบเดียวกับ webGetPendingWebRequests)
    const imgMap = {};
    ["Items", "Tools"].forEach(function (shName) {
      const sh2 = sheet(shName);
      const allRows2 = sh2.getDataRange().getValues();
      if (allRows2.length <= 1) return;
      const header2 = allRows2[0];
      const codeIdx = header2.findIndex(function (h) { return String(h).toLowerCase().trim() === "code"; });
      const imgIdx = header2.findIndex(function (h) { return String(h).toLowerCase().trim() === "imageurl"; });
      if (codeIdx < 0 || imgIdx < 0) return;
      allRows2.slice(1).forEach(function (r) {
        if (r[codeIdx]) imgMap[String(r[codeIdx]).trim()] = String(r[imgIdx] || "");
      });
    });

    const sh = sheet("WebPendingRequests");
    const items = [];
    if (sh.getLastRow() > 1) {
      const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
      rows.forEach((r) => {
        const rowUid = String(r[2] || "").trim();
        const status = String(r[11] || "").trim();
        if (rowUid === userId && status === "pending") {
          const code = String(r[4] || "");
          items.push({
            reqId: String(r[0]),
            date: r[1] instanceof Date ? formatDate(r[1]) : String(r[1] || ""),
            itemCode: code,
            itemName: String(r[5] || ""),
            qty: Number(r[6]) || 0,
            type: String(r[9] || ""),
            remark: String(r[10] || ""),
            imageUrl: imgMap[code] || "",
          });
        }
      });
    }
    return { success: true, items: items };
  } catch (e) {
    return { success: false, error: e.toString(), items: [] };
  }
}

// ผู้ใช้ยกเลิกคำขอของตัวเองที่ยังรออนุมัติอยู่ (ของที่จองไว้จะถูกปล่อยคืนทันที ไม่มีการตัดสต็อก)
function webCancelMyPendingRequest(payload) {
  payload = payload || {};
  try {
    const userId = String(payload.userId || "").trim();
    const reqId = String(payload.reqId || "").trim();
    if (!userId || !reqId) return { success: false, error: "ข้อมูลไม่ครบ" };

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      return { success: false, error: "ระบบกำลังประมวลผลรายการอื่นอยู่ กรุณาลองใหม่อีกครั้งครับ" };
    }
    try {
      const sh = sheet("WebPendingRequests");
      const rows = sh.getDataRange().getValues();
      const idx = rows.findIndex((r) => String(r[0]) === reqId);
      if (idx < 0) return { success: false, error: "ไม่พบคำขอนี้ (อาจถูกลบหรือหมดอายุ)" };
      if (String(rows[idx][2]).trim() !== userId) return { success: false, error: "คำขอนี้ไม่ใช่ของคุณ" };
      if (String(rows[idx][11]) !== "pending") return { success: false, error: "รายการนี้ถูกดำเนินการไปแล้ว ยกเลิกไม่ได้" };

      const itemName = rows[idx][5];
      const qty = rows[idx][6];
      const type = rows[idx][9];
      const userName = rows[idx][3];

      const cancelledAt = getThaiNow();
      sh.getRange(idx + 1, 12).setValue("cancelled_by_user");
      sh.getRange(idx + 1, 13).setValue(cancelledAt);
      sh.getRange(idx + 1, 14).setValue(userName);

      try {
        _writeAudit(
          "CANCEL_WEB_TX",
          `ผู้ใช้ยกเลิกคำขอ${type} ${itemName} x${qty} เอง (ก่อนแอดมินอนุมัติ)`,
          userName,
          userId,
          "-",
          "Web-QR",
        );
      } catch (e) {}

      return { success: true };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// เช็คว่าคำขอของ user คนนี้ที่เพิ่งถูกอนุมัติ/ปฏิเสธไปเมื่อครู่ มีอะไรบ้าง (สำหรับแจ้งเตือนในแอปแบบไม่ใช้โควต้า LINE)
function webGetMyRecentDecisions(payload) {
  payload = payload || {};
  try {
    const userId = String(payload.userId || "").trim();
    if (!userId) return { success: false, error: "ไม่พบ userId", items: [] };
    const sinceMs = Date.now() - 5 * 60 * 1000; // 5 นาทีล่าสุด พอสำหรับรอบโพลของหน้า QR

    const sh = sheet("WebPendingRequests");
    const items = [];
    if (sh.getLastRow() > 1) {
      const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
      rows.forEach((r) => {
        const rowUid = String(r[2] || "").trim();
        const status = String(r[11] || "").trim();
        if (rowUid !== userId) return;
        if (status !== "approved" && status !== "rejected") return;
        const decidedAt = r[12] instanceof Date ? r[12].getTime() : new Date(r[12]).getTime();
        if (isNaN(decidedAt) || decidedAt < sinceMs) return;
        items.push({
          reqId: String(r[0]),
          itemName: String(r[5] || ""),
          qty: Number(r[6]) || 0,
          type: String(r[9] || ""),
          status: status,
          decidedBy: String(r[13] || ""),
        });
      });
    }
    return { success: true, items: items };
  } catch (e) {
    return { success: false, error: e.toString(), items: [] };
  }
}

// user ที่ถูกมอบหมาย ยืนยันเบิกย้อนหลังด้วยตัวเอง พร้อมเหตุผล (เรียกจากหน้า QR ตอน login)
function webSubmitRetroWithdrawByUser(payload) {
  payload = payload || {};
  try {
    const sessionId = String(payload.sessionId || "").trim();
    const code = String(payload.itemCode || "").trim();
    const qty = Number(payload.qty);
    const remark = String(payload.remark || "").trim();
    const userId = String(payload.userId || "").trim();
    if (!sessionId || !code) return { success: false, error: "ข้อมูลไม่ครบ" };
    if (isNaN(qty) || qty <= 0) return { success: false, error: "จำนวนไม่ถูกต้อง" };
    if (!remark) return { success: false, error: "กรุณาระบุเหตุผล" };
    if (!userId) return { success: false, error: "ไม่พบผู้ใช้" };

    const usersRows = sheet("Users").getDataRange().getValues().slice(1);
    const uRow = usersRows.find((r) => String(r[0]).trim() === userId);
    const userName = uRow ? String(uRow[1] || userId) : userId;

    const info = getItemInfo(code);
    if (!info.sheet) return { success: false, error: "ไม่พบสินค้ารหัสนี้" };
    const shItem = sheet(info.sheet);
    const itemRows = shItem.getDataRange().getValues();
    let itemName = code;
    let category = "";
    let currentStock = 0;
    for (let i = 1; i < itemRows.length; i++) {
      if (String(itemRows[i][0]).trim() === code) {
        itemName = String(itemRows[i][1] || code);
        category = info.sheet === "Tools" ? "เครื่องมือ" : "อะไหล่";
        currentStock = Number(itemRows[i][5] || 0);
        break;
      }
    }

    const transId = "WD" + new Date().getTime();
    const now = getThaiNow();
    ensureSignatureColumns();
    // บันทึกเป็นรายการเบิกจริง (ย้อนหลัง) ในชื่อ user เอง — ไม่เรียก updateStock ซ้ำ
    // เพราะสต็อกถูกปรับยอดไปแล้วอัตโนมัติตอนคีย์ยอดนับในขั้นตอน webSubmitStockCount
    sheet("Withdraws").appendRow([
      transId,
      now,
      userId,
      userName,
      code,
      itemName,
      qty,
      category,
      "",
      "",
      remark + " (เบิกย้อนหลัง จากส่วนต่างนับสต็อก " + sessionId + ")",
    ]);

    sheet("Logs").appendRow([
      now,
      code,
      itemName,
      `-${qty}`,
      currentStock,
      "QR-StockTake",
      "เบิก",
      userName,
      "เบิกย้อนหลัง: " + remark,
    ]);

    const recSh = _ensureStockTakeRecordColumns(
      _stockTakeSheet("StockTakeRecords", STOCKTAKE_RECORD_HEADERS),
    );
    if (recSh.getLastRow() > 1) {
      const rows = recSh
        .getRange(2, 1, recSh.getLastRow() - 1, STOCKTAKE_RECORD_HEADERS.length)
        .getValues();
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i][0]) === sessionId && String(rows[i][1]).trim() === code) {
          recSh.getRange(i + 2, 12, 1, 2).setValues([[true, remark]]);
          break;
        }
      }
    }

    _writeAudit(
      "RETRO_WITHDRAW_BY_USER",
      `${userName} ยืนยันเบิกย้อนหลังเอง [${code}] ${itemName} x${qty} — เหตุผล: ${remark}`,
      userName,
      userId,
      "user",
      "QR-StockTake",
    );

    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ปิดรอบนับ (เฉพาะ admin)
function webCloseStockTake(payload) {
  payload = payload || {};
  try {
    if (payload.role !== "admin")
      return { success: false, error: "เฉพาะแอดมินเท่านั้นที่ปิดรอบนับได้" };
    const sessionId = payload.sessionId || _currentStockTakeSessionId();
    const sessSh = _stockTakeSheet(
      "StockTakeSessions",
      STOCKTAKE_SESSION_HEADERS,
    );
    const data = sessSh.getDataRange().getValues();
    let idx = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === sessionId) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return { success: false, error: "ไม่พบรอบนับนี้" };
    const now = new Date();
    sessSh.getRange(idx + 1, 4, 1, 1).setValue("closed");
    sessSh
      .getRange(idx + 1, 7, 1, 2)
      .setValues([[payload.userName || "Admin", now]]);
    _writeAudit(
      "CLOSE_STOCKTAKE",
      "ปิดรอบนับสต็อก " + sessionId,
      payload.userName || "Admin",
      payload.userId || "-",
      "admin",
      "Web-StockTake",
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// รายงานสรุปช่วงเวลา (เช่น ครึ่งปี) — รวมทุก session ในช่วง fromYM..toYM (รูปแบบ "YYYY-MM")
function webGetStockTakeReport(payload) {
  payload = payload || {};
  try {
    const fromYM = payload.fromYM || "0000-00";
    const toYM = payload.toYM || "9999-99";
    const ss = getActiveSpreadsheetInstance();
    const sessSh = ss.getSheetByName("StockTakeSessions");
    const recSh = ss.getSheetByName("StockTakeRecords");
    if (!sessSh || !recSh) return { success: true, records: [], sessions: [] };

    const toKey = (y, m) => y + "-" + String(m).padStart(2, "0");
    const sessRows =
      sessSh.getLastRow() > 1
        ? sessSh
            .getRange(
              2,
              1,
              sessSh.getLastRow() - 1,
              STOCKTAKE_SESSION_HEADERS.length,
            )
            .getValues()
        : [];
    const validIds = new Set(
      sessRows
        .filter((r) => {
          const k = toKey(r[1], r[2]);
          return k >= fromYM && k <= toYM;
        })
        .map((r) => String(r[0])),
    );

    const recRows =
      recSh.getLastRow() > 1
        ? recSh
            .getRange(
              2,
              1,
              recSh.getLastRow() - 1,
              STOCKTAKE_RECORD_HEADERS.length,
            )
            .getValues()
        : [];
    const records = recRows
      .filter((r) => validIds.has(String(r[0])))
      .map((r) => ({
        sessionId: r[0],
        itemCode: r[1],
        itemName: r[2],
        systemStock: r[3],
        countedQty: r[4],
        diff: r[5],
        unit: r[6],
        countedBy: r[7],
        role: r[8],
        source: r[9],
        timestamp:
          r[10] instanceof Date ? formatDate(r[10]) : String(r[10] || ""),
      }));

    const sessions = sessRows
      .filter((r) => validIds.has(String(r[0])))
      .map((r) => ({
        sessionId: r[0],
        year: r[1],
        month: r[2],
        status: r[3],
        startedBy: r[4],
        closedBy: r[6],
        totalItems: r[8],
        countedItems: r[9],
      }));

    return {
      success: true,
      records: records,
      sessions: sessions,
      diffCount: records.filter((r) => r.diff !== 0).length,
    };
  } catch (e) {
    return { success: false, error: e.toString(), records: [] };
  }
}

function _archiveSheetName(year, month) {
  const pad = (n) => String(n).padStart(2, "0");
  return "Archive_" + year + "_" + pad(month);
}

// ปิดเดือน: ย้ายแถวใน Logs ของเดือน/ปีที่เลือก ไปสร้างเป็นชีต Archive_YYYY_MM แล้วลบออกจาก Logs
function webArchiveMonth(payload) {
  const auth = _requireRole(payload.userId, ["admin"]);
  if (!auth.ok) return auth;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000))
    return { success: false, error: "ระบบกำลังประมวลผลอยู่ ลองใหม่อีกครั้ง" };
  try {
    const year = parseInt(payload.year);
    const month = parseInt(payload.month);
    if (!year || !month)
      return { success: false, error: "กรุณาเลือกเดือน/ปีให้ถูกต้อง" };

    const ss = getActiveSpreadsheetInstance();
    const logSh = ss.getSheetByName("Logs");
    if (!logSh || logSh.getLastRow() < 2)
      return { success: false, error: "ไม่พบข้อมูลใน Logs" };

    const data = logSh.getDataRange().getValues();
    const headers = data[0];

    // หาแถวที่อยู่ในเดือน/ปีที่เลือก (คอลัมน์ A = วันที่)
    const matchedRows = [];
    const rowIndexesToDelete = []; // เก็บเลขแถวจริงในชีต (1-based) เรียงจากมากไปน้อย
    for (let i = 1; i < data.length; i++) {
      const cellDate = data[i][0];
      if (!(cellDate instanceof Date)) continue;
      if (
        cellDate.getFullYear() === year &&
        cellDate.getMonth() + 1 === month
      ) {
        matchedRows.push(data[i]);
        rowIndexesToDelete.push(i + 1);
      }
    }

    if (matchedRows.length === 0) {
      return { success: false, error: "ไม่มีข้อมูลในเดือนที่เลือก" };
    }

    const archiveName = _archiveSheetName(year, month);
    let archiveSh = ss.getSheetByName(archiveName);
    if (!archiveSh) {
      archiveSh = ss.insertSheet(archiveName);
      archiveSh.appendRow(headers);
      archiveSh.setFrozenRows(1);
    }
    archiveSh
      .getRange(
        archiveSh.getLastRow() + 1,
        1,
        matchedRows.length,
        headers.length,
      )
      .setValues(matchedRows);

    // ลบแถวออกจาก Logs จากท้ายขึ้นต้น กันเลขแถวเลื่อน
    rowIndexesToDelete.sort((a, b) => b - a);
    rowIndexesToDelete.forEach((r) => logSh.deleteRow(r));

    _writeAudit(
      "ARCHIVE_MONTH",
      `ปิดเดือน ${month}/${year} — ย้าย ${matchedRows.length} รายการไปยัง ${archiveName}`,
      payload.userName || "Admin",
      payload.userId || "-",
      "admin",
      "Web-Archive",
    );

    return {
      success: true,
      archiveName: archiveName,
      totalRows: matchedRows.length,
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// ดึงรายชื่อ Archive sheet ทั้งหมดที่มีอยู่ในไฟล์ (ชื่อขึ้นต้นด้วย Archive_)
function webGetArchiveList() {
  try {
    const ss = getActiveSpreadsheetInstance();
    const sheets = ss.getSheets();
    const archives = sheets
      .filter((sh) => sh.getName().indexOf("Archive_") === 0)
      .map((sh) => ({
        name: sh.getName(),
        rows: Math.max(sh.getLastRow() - 1, 0),
        url: ss.getUrl() + "#gid=" + sh.getSheetId(),
      }))
      .sort((a, b) => b.name.localeCompare(a.name));
    return { success: true, archives: archives };
  } catch (e) {
    return { success: false, error: e.toString(), archives: [] };
  }
}

// กู้คืน: ย้ายข้อมูลจาก Archive sheet กลับเข้า Logs แล้วลบชีต Archive นั้นทิ้ง
function webRestoreArchive(archiveName, actorUserId) {
  const auth = _requireRole(actorUserId, ["admin"]);
  if (!auth.ok) return auth;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000))
    return { success: false, error: "ระบบกำลังประมวลผลอยู่ ลองใหม่อีกครั้ง" };
  try {
    const ss = getActiveSpreadsheetInstance();
    const archiveSh = ss.getSheetByName(archiveName);
    if (!archiveSh) return { success: false, error: "ไม่พบ Archive นี้" };

    const data = archiveSh.getDataRange().getValues();
    if (data.length < 2) {
      ss.deleteSheet(archiveSh);
      return { success: false, error: "Archive นี้ไม่มีข้อมูล" };
    }
    const rows = data.slice(1);

    const logSh = sheet("Logs");
    logSh
      .getRange(logSh.getLastRow() + 1, 1, rows.length, rows[0].length)
      .setValues(rows);

    ss.deleteSheet(archiveSh);

    _writeAudit(
      "RESTORE_ARCHIVE",
      `กู้คืนข้อมูลจาก ${archiveName} — ${rows.length} รายการ กลับสู่ Logs`,
      "Admin",
      "-",
      "admin",
      "Web-Archive",
    );

    return { success: true, restoredRows: rows.length };
  } catch (e) {
    return { success: false, error: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// ฟังก์ชันตรวจเช็คและเพิ่มคอลัมน์ SignatureUrl อัตโนมัติในชีตต่างๆ เพื่อความปลอดภัยในการทำงาน
function ensureSignatureColumns() {
  try {
    const ss = getActiveSpreadsheetInstance();
    
    // 1. WebPendingRequests
    const pendingSh = ss.getSheetByName("WebPendingRequests");
    if (pendingSh) {
      const header = pendingSh.getRange(1, 1, 1, pendingSh.getLastColumn()).getValues()[0];
      if (header.indexOf("SignatureUrl") === -1) {
        pendingSh.getRange(1, 15).setValue("SignatureUrl");
      }
    }
    
    // 2. Requests
    const reqSh = ss.getSheetByName("Requests");
    if (reqSh) {
      const header = reqSh.getRange(1, 1, 1, reqSh.getLastColumn()).getValues()[0];
      if (header.indexOf("SignatureUrl") === -1) {
        reqSh.getRange(1, 10).setValue("SignatureUrl");
      }
    }
    
    // 3. Withdraws
    const wdSh = ss.getSheetByName("Withdraws");
    if (wdSh) {
      const header = wdSh.getRange(1, 1, 1, wdSh.getLastColumn()).getValues()[0];
      if (header.indexOf("SignatureUrl") === -1) {
        wdSh.getRange(1, 10).setValue("SignatureUrl");
      }
    }
    
    // 4. BorrowRequests
    const borrowSh = ss.getSheetByName("BorrowRequests");
    if (borrowSh) {
      const header = borrowSh.getRange(1, 1, 1, borrowSh.getLastColumn()).getValues()[0];
      if (header.indexOf("SignatureUrl") === -1) {
        borrowSh.getRange(1, 13).setValue("SignatureUrl");
      }
    }
  } catch (e) {
    Logger.log("ensureSignatureColumns error: " + e.toString());
  }
}

// 🆕 ดึงข้อมูลประวัติการทำรายการเพื่อออกใบเบิก (Slip/Receipt) ย้อนหลังพร้อมลายเซ็น
function webGetReceiptData(code, time, user, amount, action) {
  try {
    const ss = getActiveSpreadsheetInstance();
    const isWithdraw = String(action).includes("เบิก");
    const isBorrow = String(action).includes("ยืม");
    
    if (!isWithdraw && !isBorrow) {
      return { success: false, error: "ประเภทรายการไม่รองรับใบเบิก" };
    }
    
    const sheetName = isWithdraw ? "Withdraws" : "BorrowRequests";
    const sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) {
      return { success: false, error: "ไม่พบข้อมูลประวัติทำรายการ" };
    }
    
    const rows = sh.getDataRange().getValues();
    const headers = rows[0];
    
    // ค้นหาคอลัมน์สำคัญ
    const codeIdx = headers.findIndex(function(h) { return String(h).toLowerCase().trim() === "code"; });
    const qtyIdx = headers.findIndex(function(h) { return String(h).toLowerCase().trim() === "qty"; });
    const userColName = isWithdraw ? "userName" : "borrower";
    const userIdx = headers.findIndex(function(h) { return String(h).toLowerCase().trim() === userColName.toLowerCase(); });
    const sigUrlIdx = headers.indexOf("SignatureUrl");
    
    const targetCode = String(code).trim().toLowerCase();
    const targetQty = Math.abs(parseFloat(String(amount).replace(/[^0-9.-]/g, "")));
    const targetUser = String(user).trim().toLowerCase();
    
    let foundRow = null;
    
    // ค้นหาแบบละเอียดด้วยความต่างของเวลาน้อยกว่า 3 นาที (ค้นจากรายการล่าสุดย้อนขึ้น)
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i];
      const rCode = String(r[codeIdx >= 0 ? codeIdx : 4]).trim().toLowerCase();
      const rQty = Math.abs(parseFloat(String(r[qtyIdx >= 0 ? qtyIdx : 6])));
      const rUser = String(r[userIdx >= 0 ? userIdx : 3]).trim().toLowerCase();
      
      if (rCode === targetCode && rQty === targetQty && rUser.includes(targetUser)) {
        const logDateObj = parseThaiDate(time);
        const sheetDateObj = r[1] instanceof Date ? r[1] : new Date(r[1]);
        
        let timeDiffMatch = false;
        if (logDateObj && sheetDateObj && !isNaN(sheetDateObj.getTime())) {
          const diffMs = Math.abs(logDateObj.getTime() - sheetDateObj.getTime());
          if (diffMs <= 180 * 1000) { // ภายใน 3 นาที
            timeDiffMatch = true;
          }
        }
        
        if (timeDiffMatch) {
          foundRow = r;
          break;
        }
      }
    }
    
    // หากไม่พบแบบละเอียด ให้หาตัวที่ใกล้เคียงที่สุดจากรหัส, จำนวน และชื่อ
    // ค้นจากท้ายชีต (รายการล่าสุด) ย้อนขึ้นไป เพื่อไม่ให้จับรายการเก่าที่ซ้ำรหัส/จำนวน/ชื่อผิดตัว
    if (!foundRow) {
      for (let i = rows.length - 1; i >= 1; i--) {
        const r = rows[i];
        const rCode = String(r[codeIdx >= 0 ? codeIdx : 4]).trim().toLowerCase();
        const rQty = Math.abs(parseFloat(String(r[qtyIdx >= 0 ? qtyIdx : 6])));
        const rUser = String(r[userIdx >= 0 ? userIdx : 3]).trim().toLowerCase();
        if (rCode === targetCode && rQty === targetQty && rUser.includes(targetUser)) {
          foundRow = r;
          break;
        }
      }
    }
    
    if (!foundRow) {
      return { success: false, error: "ไม่พบใบเบิกต้นฉบับในฐานข้อมูล" };
    }
    
    const sigUrl = sigUrlIdx >= 0 ? String(foundRow[sigUrlIdx]) : "";
    const rUserName = String(foundRow[userIdx >= 0 ? userIdx : 3]);

    // ดึงแผนกจาก Users sheet คอลัมน์ E (index 4) โดยจับคู่จากชื่อผู้ทำรายการ
    let userDept = "-";
    try {
      const usersSh = ss.getSheetByName("Users");
      if (usersSh && usersSh.getLastRow() > 1) {
        const usersRows = usersSh.getDataRange().getValues();
        const uRow = usersRows.find(function(r) {
          return String(r[1]).trim().toLowerCase() === rUserName.trim().toLowerCase();
        });
        if (uRow && uRow[4]) userDept = String(uRow[4]);
      }
    } catch (e) {}

    return {
      success: true,
      transId: String(foundRow[0]),
      date: formatDate(foundRow[1]),
      user: rUserName,
      itemCode: String(foundRow[codeIdx >= 0 ? codeIdx : 4]),
      itemName: String(foundRow[5]),
      qty: String(foundRow[qtyIdx >= 0 ? qtyIdx : 6]),
      category: String(foundRow[7] || "-"),
      remark: isWithdraw ? String(foundRow[10] || "-") : String(foundRow[11] || "-"),
      signatureUrl: sigUrl,
      machine: userDept,
      dept: userDept,
      type: isWithdraw ? "เบิก" : "ยืม"
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}


// 🆕 ฟังก์ชันช่วยแปลงรูปแบบเวลาจาก Logs หน้าเว็บกลับเป็น Date
function parseThaiDate(dateStr) {
  if (!dateStr || dateStr === "-") return null;
  try {
    const parts = String(dateStr).trim().split(" ");
    if (parts.length < 2) return null;
    const dateParts = parts[0].split("/");
    const timeParts = parts[1].split(":");
    if (dateParts.length < 3 || timeParts.length < 2) return null;
    
    const day = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1;
    let year = parseInt(dateParts[2], 10);
    if (year < 100) {
      year += 2000 - 543;
    } else if (year > 2400) {
      year -= 543;
    }
    
    const hour = parseInt(timeParts[0], 10);
    const minute = parseInt(timeParts[1], 10);
    const second = timeParts[2] ? parseInt(timeParts[2], 10) : 0;
    
    return new Date(year, month, day, hour, minute, second);
  } catch (e) {
    return null;
  }
}
// ============================================================
// 🤖 FULL AI MODULE (GEMINI 1.5 INTEGRATION)
// ============================================================

// ฟังก์ชันกลางสำหรับเรียกใช้ Gemini API (รองรับทั้ง Text & Vision)
function _callGeminiAI(prompt, base64Img, mimeType) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) throw new Error("ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Script Properties");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
  
  let parts = [{ text: prompt }];
  if (base64Img) {
    parts.push({
      inline_data: {
        mime_type: mimeType || "image/jpeg",
        data: base64Img
      }
    });
  }

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ contents: [{ parts: parts }] }),
    muteHttpExceptions: true
  });

  const resJson = JSON.parse(response.getContentText());
  if (resJson.candidates && resJson.candidates[0] && resJson.candidates[0].content) {
    return resJson.candidates[0].content.parts[0].text;
  } else {
    throw new Error("AI Error: " + response.getContentText());
  }
}

// ------------------------------------------------------------
// 1. AI Chat Assistant (ตอบคำถามเกี่ยวกับคลังสินค้า)
// ------------------------------------------------------------
function webAskAiAssistant(question) {
  try {
    const data = getInventoryData();
    const items = data.items || [];
    const tools = data.tools || [];

    // ส่งรายการอะไหล่/เครื่องมือทั้งหมดให้ AI เห็นครบ (เดิมตัดแค่ 40 รายการแรก ทำให้ AI มองไม่เห็นของส่วนใหญ่ในคลัง)
    const itemsSummary = items.map(i => `[${i.code}] ${i.name} | หมวด:${i.category||'-'} | คงเหลือ:${i.stock} ${i.unit} | Min:${i.min}`).join("\n") || "(ไม่มีข้อมูล)";
    const toolsSummary = tools.map(t => `[${t.code}] ${t.name} | หมวด:${t.category||'-'} | คงเหลือ:${t.stock} ${t.unit} | Min:${t.min}`).join("\n") || "(ไม่มีข้อมูล)";

    // คำนวณสรุปล่วงหน้าให้ AI ใช้อ้างอิงตรงๆ แทนที่จะต้องเดาเองจากรายการดิบ
    const lowStockItems = items.filter(i => Number(i.stock) <= Number(i.min));
    const lowStockTools = tools.filter(t => Number(t.stock) <= Number(t.min));
    const lowStockSummary = lowStockItems.concat(lowStockTools)
      .map(p => `[${p.code}] ${p.name} เหลือ ${p.stock} ${p.unit} (Min ${p.min})`).join("\n") || "ไม่มีรายการต่ำกว่า Min ตอนนี้";

    const categoryMap = {};
    items.concat(tools).forEach(p => {
      const c = p.category || "ไม่ระบุ";
      categoryMap[c] = (categoryMap[c] || 0) + 1;
    });
    const categorySummary = Object.keys(categoryMap).sort().map(c => `- ${c}: ${categoryMap[c]} รายการ`).join("\n");

    const borrowsSummary = (data.activeBorrows || []).slice(0, 50).map(b => `- [${b.itemCode||''}] ${b.itemName} x${b.qty} ยืมโดย ${b.borrower} (${b.date})`).join("\n") || "ไม่มีของค้างยืมตอนนี้";
    const historySummary = (data.history || []).slice(0, 80).map(h => `- ${h.time} | ${h.action} | [${h.code||''}] ${h.item} | x${h.amount} | ผู้ทำรายการ: ${h.user}`).join("\n") || "(ไม่มีประวัติ)";
    const todayStr = Utilities.formatDate(new Date(), "Asia/Bangkok", "dd/MM/yyyy HH:mm");

    const prompt = `คุณคือผู้ช่วยปัญญาประดิษฐ์ประจําคลังอะไหล่เมาท์เทน มีหน้าที่ช่วยวิเคราะห์และตอบคำถามเกี่ยวกับคลังสินค้าอย่างละเอียด ถูกต้อง และเป็นประโยชน์จริงกับผู้ดูแลคลัง ไม่ใช่แค่สรุปสั้นๆ ผิวเผิน
ข้อมูลคลังสินค้า ณ วันเวลาปัจจุบัน: ${todayStr}

[สรุปจำนวนตามหมวดหมู่]:
${categorySummary}

[รายการที่ต่ำกว่า Min ต้องสั่งเติมตอนนี้]:
${lowStockSummary}

[รายการอะไหล่ทั้งหมดในคลัง]:
${itemsSummary}

[รายการเครื่องมือทั้งหมดในคลัง]:
${toolsSummary}

[รายการค้างยืมปัจจุบัน]:
${borrowsSummary}

[ประวัติการทำรายการล่าสุด (Logs เบิก/คืน/รับเข้า)]:
${historySummary}

คำถามจากผู้ใช้: "${question}"

คำแนะนำในการตอบ:
1. ตอบเป็นภาษาไทย อ้างอิงจากข้อมูลด้านบนเท่านั้น ห้ามเดาหรือสมมติตัวเลขเอง
2. ถ้าคำถามเกี่ยวกับสินค้า/เครื่องมือเฉพาะรายการ ให้ใส่โค้ดในวงเล็บเหลี่ยมแบบ [CODE] กำกับทุกครั้งที่พูดถึง เพื่อให้ระบบดึงรูปสินค้ามาแสดงได้ถูกต้อง
3. ถ้าผู้ใช้ให้วิเคราะห์หาความผิดปกติ (Anomaly) ให้ตรวจสอบจากประวัติ Logs ว่ามีการเบิกจำนวนมากผิดสังเกต, เบิกซ้ำถี่ในเวลาสั้น, หรือรายการที่ดูน่าสงสัย แล้วอธิบายเหตุผลว่าทำไมถึงผิดปกติ ไม่ใช่แค่บอกว่า "ไม่พบ"
4. ถ้าคำถามเป็นการขอสรุปภาพรวม ให้ตอบแบบมีโครงสร้าง (หัวข้อย่อย/bullet) ครอบคลุมทั้งสต็อกอะไหล่ เครื่องมือ ของค้างยืม และของใกล้หมด ไม่ใช่ตอบสั้นประโยคเดียว
5. ถ้าข้อมูลที่มีไม่พอตอบคำถาม ให้บอกตรงๆ ว่าข้อมูลส่วนไหนที่ไม่มีในระบบ แทนที่จะแต่งคำตอบขึ้นมา
6. ใช้ Emoji ประกอบพอประมาณให้อ่านง่าย ไม่ต้องเยอะเกินไป`;

    const reply = _callGeminiAI(prompt);
    return { success: true, answer: reply };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ------------------------------------------------------------
// 2. AI OCR อ่านใบส่งของ / ใบ PO จากรูปถ่าย
// ------------------------------------------------------------
function webAnalyzeInvoiceImage(base64Img, mimeType) {
  try {
    const prompt = `อ่านข้อมูลจากรูปภาพใบส่งของ/ใบสั่งซื้อ/PO นี้ แล้วตอบกลับเป็น JSON สตริงบริสุทธิ์เท่านั้น (ห้ามมี markdown codeblock หรือข้อความอื่น):
{
  "poCode": "เลขที่ PO หรือเลขใบส่งของ (ถ้าไม่มีให้เว้นว่าง)",
  "supplier": "ชื่อซัพพลายเออร์/บริษัทผู้จัดส่ง",
  "date": "YYYY-MM-DD",
  "items": [
    { "itemName": "ชื่อสินค้า", "qty": จำนวนตัวเลข },
    ...
  ],
  "remark": "สรุปหมายเหตุเพิ่มเติมสั้นๆ"
}`;

    const rawReply = _callGeminiAI(prompt, base64Img, mimeType);
    const cleanJson = rawReply.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanJson);
    return { success: true, data: parsed };
  } catch (e) {
    return { success: false, error: "AI อ่านเอกสารไม่สำเร็จ: " + e.toString() };
  }
}

// ------------------------------------------------------------
// 3. AI Anomaly Detection (ตรวจจับเบิกจ่ายผิดปกติ)
// ------------------------------------------------------------
function checkWithdrawAnomaly(itemCode, qty) {
  try {
    const shLogs = sheet("Logs");
    if (shLogs.getLastRow() < 2) return { isAnomaly: false };

    const rows = shLogs.getDataRange().getValues().slice(1);
    const pastQtys = [];
    rows.forEach(r => {
      if (String(r[1]).trim() === String(itemCode).trim() && (String(r[6]).includes("เบิก") || String(r[6]).includes("Withdraw"))) {
        const q = Math.abs(parseFloat(String(r[3]).replace(/[^0-9.]/g, "")));
        if (!isNaN(q) && q > 0) pastQtys.push(q);
      }
    });

    if (pastQtys.length < 3) return { isAnomaly: false }; // ข้อมูลย้อนหลังยังไม่พอ

    const avg = pastQtys.reduce((a, b) => a + b, 0) / pastQtys.length;
    // ถ้าเบิกเกิน 3 เท่าของค่าเฉลี่ยในอดีต
    if (qty > avg * 3 && qty > 5) {
      return {
        isAnomaly: true,
        warning: `⚠️ AI Warning: จำนวนเบิก ${qty} สูงกว่าค่าเฉลี่ยอดีต (${avg.toFixed(1)}) เกิน 3 เท่า`
      };
    }
    return { isAnomaly: false };
  } catch (e) {
    return { isAnomaly: false };
  }
}

// ------------------------------------------------------------
// 4. AI Smart Catalog (แนะนำหมวดหมู่และหน่วยนับให้อัตโนมัติ)
// ------------------------------------------------------------
function webSuggestItemCatalog(itemName) {
  try {
    const prompt = `ช่วยแนะนำ หมวดหมู่ (Category) และ หน่วยนับ (Unit) ภาษาไทยที่เหมาะสมสำหรับอะไหล่/เครื่องมือชื่อ: "${itemName}"
ตอบกลับเป็น JSON สตริงบริสุทธิ์เท่านั้น:
{
  "category": "ชื่อหมวดหมู่สั้นๆ เช่น ไฟฟ้า, ระบบน้ำ, เครื่องมือ, Hardware, เครื่องจักร",
  "unit": "หน่วยนับ เช่น ชิ้น, อัน, ตัว, ชุด, เมตร, ม้วน, ลิตร"
}`;

    const rawReply = _callGeminiAI(prompt);
    const cleanJson = rawReply.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanJson);
    return { success: true, data: parsed };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}