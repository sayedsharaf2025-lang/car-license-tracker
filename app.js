/* ============================================================
   EL BANNA GROUP — Fleet Management System
   Main Application Logic — v2.0
   ============================================================ */

// ======================== Firebase Configuration ========================
const firebaseConfig = {
  apiKey:            "AIzaSyBOQ1K6djn81iOZ2R251k1Ky_kCFUGdn9Y",
  authDomain:        "car-inovi.firebaseapp.com",
  databaseURL:       "https://car-inovi-default-rtdb.firebaseio.com",
  projectId:         "car-inovi",
  storageBucket:     "car-inovi.firebasestorage.app",
  messagingSenderId: "396152886628",
  appId:             "1:396152886628:web:fd55e20311231137af9671"
};

let db = null;

// ينتظر تحميل Firebase من CDN ثم يهيّئ التطبيق
function waitForFirebase(attempt) {
  if (typeof firebase !== "undefined") {
    try {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db = firebase.database();
      db.ref(".info/connected").on("value", snap => {
        setStatus(snap.val() ? "ok" : "warn", snap.val() ? "متصل بقاعدة البيانات" : "غير متصل — يُعيد الاتصال...");
      });
    } catch(e) {
      console.error("Firebase init error:", e);
      showFirebaseError("فشل تهيئة Firebase: " + e.message);
    }
  } else if (attempt < 40) {
    // انتظر 250ms وحاول مجدداً (حد أقصى 10 ثوانٍ)
    setTimeout(() => waitForFirebase(attempt + 1), 250);
  } else {
    showFirebaseError("لم يتم تحميل Firebase بعد 10 ثوانٍ. تحقق من اتصالك بالإنترنت.");
  }
}

function showFirebaseError(msg) {
  document.getElementById("login-screen").innerHTML = `
    <div style="text-align:center;padding:40px;max-width:420px;margin:0 auto;background:#fff;border-radius:20px;box-shadow:0 10px 40px rgba(0,0,0,.2)">
      <div style="font-size:3rem;margin-bottom:12px">🔌</div>
      <h2 style="color:#dc2626;margin-bottom:8px">خطأ في الاتصال</h2>
      <p style="color:#64748b;font-size:.85rem;line-height:1.6;margin-bottom:16px">${msg}</p>
      <p style="color:#94a3b8;font-size:.78rem;margin-bottom:16px">تأكد من اتصالك بالإنترنت ثم أعد تحميل الصفحة</p>
      <button onclick="location.reload()" style="padding:10px 24px;background:#2563eb;color:#fff;border:none;border-radius:10px;font-size:.9rem;font-weight:700;cursor:pointer">🔄 إعادة التحميل</button>
    </div>
  `;
  document.getElementById("login-screen").style.display = "flex";
}

window.addEventListener("load", () => waitForFirebase(0));

// ======================== Global State ========================
let SYS = {
  cars: {}, violations: {}, supervisors: {}, invoices: {},
  config: { adminPass:"1234", trafficPass:"5678", financePass:"9999", managerPass:"0000", custody: 0 },
  managerExpenses: {}, managerAssignments: {}, managerVisaCards: {}
};
let currentUser  = null;
let activeInv    = null;
let lastPrintScreen = "reports";
let confirmCb    = null;
let LIC_FILTER   = "all";
let idleTimer    = null;
let liveListener = null;

// ======================== Login ========================
function doLogin() {
  if (!db) {
    alert("⏳ جاري الاتصال بقاعدة البيانات، انتظر لحظة ثم أعد المحاولة...");
    return;
  }
  const user   = document.getElementById("login-user").value.trim();
  const pass   = document.getElementById("login-pass").value;
  const errEl  = document.getElementById("login-error");
  const btn    = document.getElementById("login-btn");

  errEl.style.display = "none";
  if (!user || !pass) {
    errEl.textContent  = "أدخل اسم المستخدم وكلمة المرور";
    errEl.style.display = "block";
    return;
  }

  btn.disabled   = true;
  btn.textContent = "جاري التحقق...";

  // Load config from Firebase first to get latest passwords
  db.ref("config").once("value", snap => {
    const cfg = snap.val();
    if (cfg) Object.assign(SYS.config, cfg);

    btn.disabled   = false;
    btn.textContent = "تسجيل الدخول";

    // Check admin
    if (user === "admin" && pass === SYS.config.adminPass) {
      currentUser = { username:"admin", name:"المدير العام", role:"admin" };
    } else {
      let found = false;

      // Check supervisors
      const sups = snap.ref.parent; // re-read supervisors
      db.ref("supervisors").once("value", ssSnap => {
        const supsData = ssSnap.val() || {};
        Object.entries(supsData).forEach(([k, s]) => {
          if (s.username === user && s.password === pass) {
            currentUser = { username:user, name:s.name, role:"supervisor", key:k };
            found = true;
          }
        });

        if (!found) {
          const roleUsers = [
            { username:"traffic",  pass: SYS.config.trafficPass,  name:"مدير الحركة",   role:"traffic"  },
            { username:"finance",  pass: SYS.config.financePass,  name:"المدير المالي", role:"finance"  },
            { username:"manager",  pass: SYS.config.managerPass || "0000",  name:"المشرف العام",  role:"manager"  }
          ];
          for (const ru of roleUsers) {
            if (user === ru.username && pass === ru.pass) {
              currentUser = ru; found = true; break;
            }
          }
        }

        if (!found) {
          errEl.textContent  = "اسم المستخدم أو كلمة المرور غير صحيحة";
          errEl.style.display = "block";
          return;
        }

        // Login success
        document.getElementById("login-screen").style.display = "none";
        document.getElementById("app").style.display           = "flex";
        document.getElementById("display-user").textContent   = currentUser.name;
        buildNav();
        setupLiveSync();
        showScreen("dashboard");
        resetIdle();
      });
      return;
    }

    // Admin login success (direct, no supervisor check needed)
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("app").style.display           = "flex";
    document.getElementById("display-user").textContent   = currentUser.name;
    buildNav();
    setupLiveSync();
    showScreen("dashboard");
    resetIdle();
  });
}

function doLogout() {
  if (liveListener) { db.ref("/").off("value", liveListener); liveListener = null; }
  currentUser = null;
  activeInv   = null;
  document.getElementById("app").style.display          = "none";
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("login-user").value  = "";
  document.getElementById("login-pass").value  = "";
  document.getElementById("login-error").style.display = "none";
  clearTimeout(idleTimer);
}

// ======================== Navigation by Role ========================
const SCREENS = {
  dashboard:        { icon:"fa-house",            label:"الرئيسية",          roles:["admin","supervisor","traffic","finance","manager"] },
  "admin-vios":     { icon:"fa-gavel",             label:"المخالفات",          roles:["admin"] },
  "admin-cars":     { icon:"fa-car",               label:"السيارات",           roles:["admin"] },
  "admin-licenses": { icon:"fa-id-card",           label:"التراخيص",           roles:["admin"] },
  "admin-sups":     { icon:"fa-users",             label:"المشرفون",           roles:["admin"] },
  "admin-security": { icon:"fa-lock",              label:"كلمات المرور",       roles:["admin"] },
  "admin-invoices": { icon:"fa-file-invoice",      label:"الفواتير",           roles:["admin"] },
  supervisor:       { icon:"fa-user-gear",         label:"فاتورة مصروف",       roles:["supervisor"] },
  traffic:          { icon:"fa-traffic-light",     label:"مدير الحركة",        roles:["traffic"] },
  finance:          { icon:"fa-wallet",            label:"المدير المالي",      roles:["finance"] },
  manager:          { icon:"fa-receipt",           label:"المصروفات العامة",   roles:["manager"] },
  reports:          { icon:"fa-chart-pie",         label:"التقارير",           roles:["admin","traffic","finance","manager"] },
  settings:         { icon:"fa-gear",              label:"الإعدادات",          roles:["admin"] }
};

function buildNav() {
  const nav = document.getElementById("main-nav");
  nav.innerHTML = "";
  Object.entries(SCREENS).forEach(([id, cfg]) => {
    if (!cfg.roles.includes(currentUser.role)) return;
    const btn = document.createElement("button");
    btn.className = "nav-btn";
    btn.id        = "nav-" + id;
    btn.innerHTML = `<i class="fa-solid ${cfg.icon}"></i> ${cfg.label}`;
    btn.onclick   = () => showScreen(id);
    nav.appendChild(btn);
  });
}

function showScreen(id) {
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  const sec    = document.getElementById("sec-" + id);
  const navBtn = document.getElementById("nav-" + id);
  if (sec)    sec.classList.add("active");
  if (navBtn) navBtn.classList.add("active");
  renderScreen(id);
}

function renderScreen(id) {
  switch(id) {
    case "dashboard":        renderDashboard();      break;
    case "admin-vios":       renderAdminBalances();  break;
    case "admin-cars":       renderAdminCars();      break;
    case "admin-licenses":   renderLicenses();       break;
    case "admin-sups":       renderAdminSups();      break;
    case "admin-invoices":   renderAdminInvoices();  break;
    case "supervisor":       renderSupervisor();     break;
    case "traffic":          renderTraffic();        break;
    case "finance":          renderFinance();        break;
    case "manager":          renderManager();        break;
    case "reports":          renderReports();        break;
  }
}

function getCurrentScreen() {
  const a = document.querySelector(".section.active");
  return a ? a.id.replace("sec-","") : "dashboard";
}

// ======================== Tabs ========================
function switchTab(section, tabId, btn) {
  const sec = document.getElementById("sec-" + section);
  if (!sec) return;
  sec.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
  sec.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  const tc = document.getElementById(tabId);
  if (tc) tc.classList.add("active");
  if (btn) btn.classList.add("active");
  // Auto-render for manager statement
  if (tabId === "tab-mgr-stmt") renderMgrStatement();
}

// ======================== Load All Data ========================
function loadAll() {
  setStatus("loading", "جاري التحديث...");
  db.ref("/").once("value", snap => {
    const v = snap.val();
    if (v) {
      SYS.cars               = v.cars               || {};
      SYS.violations         = v.violations         || {};
      SYS.supervisors        = v.supervisors        || {};
      SYS.invoices           = v.invoices           || {};
      SYS.config             = Object.assign({}, SYS.config, v.config || {});
      SYS.managerExpenses    = v.managerExpenses    || {};
      SYS.managerAssignments = v.managerAssignments || {};
      SYS.managerVisaCards   = v.managerVisaCards   || {};
    }
    renderScreen(getCurrentScreen());
    setStatus("ok", "متصل — آخر تحديث: " + new Date().toLocaleTimeString("ar-EG"));
    toast("✅ تم التحديث", "ok");
  });
}

// ======================== Live Sync ========================
function setupLiveSync() {
  if (liveListener) db.ref("/").off("value", liveListener);
  liveListener = db.ref("/").on("value", snap => {
    const v = snap.val();
    if (!v) return;
    SYS.cars               = v.cars               || {};
    SYS.violations         = v.violations         || {};
    SYS.supervisors        = v.supervisors        || {};
    SYS.invoices           = v.invoices           || {};
    SYS.config             = Object.assign({}, SYS.config, v.config || {});
    SYS.managerExpenses    = v.managerExpenses    || {};
    SYS.managerAssignments = v.managerAssignments || {};
    SYS.managerVisaCards   = v.managerVisaCards   || {};
    setStatus("ok", "متصل — تحديث تلقائي مفعّل");
    renderScreen(getCurrentScreen());
  });
}

// ======================== Dashboard ========================
function renderDashboard() {
  const cars       = Object.keys(SYS.cars).length;
  const vios       = Object.values(SYS.violations).filter(v => Number(v.amount) > 0).reduce((s,v) => s + Number(v.amount||0), 0);
  const supCustody = Object.values(SYS.supervisors).reduce((s,v) => s + Number(v.custody||0), 0);
  const pending    = Object.values(SYS.invoices).filter(i => i.status === "pending_approval").length;
  const approved   = Object.values(SYS.invoices).filter(i => i.status === "approved").length;
  const finalized  = Object.values(SYS.invoices).filter(i => i.status === "finalized").length;

  // Expiry alerts
  const expSoon = Object.values(SYS.cars).filter(c => { const d = daysDiff(c.expiry); return d >= 0 && d <= 30; }).length;
  const expNow  = Object.values(SYS.cars).filter(c => daysDiff(c.expiry) < 0).length;

  document.getElementById("dash-stats").innerHTML = `
    <div class="stat-card blue"><div class="stat-label">إجمالي السيارات</div><div class="stat-val">${cars}</div></div>
    <div class="stat-card red"><div class="stat-label">إجمالي المخالفات</div><div class="stat-val">${fmt(vios)} ج</div></div>
    <div class="stat-card green"><div class="stat-label">إجمالي العهد</div><div class="stat-val">${fmt(supCustody)} ج</div></div>
    <div class="stat-card gold"><div class="stat-label">فواتير قيد الاعتماد</div><div class="stat-val">${pending + approved}</div></div>
    <div class="stat-card teal"><div class="stat-label">فواتير منتهية</div><div class="stat-val">${finalized}</div></div>
    ${expNow ? `<div class="stat-card red"><div class="stat-label">تراخيص منتهية</div><div class="stat-val">${expNow}</div></div>` : ""}
    ${expSoon ? `<div class="stat-card gold"><div class="stat-label">تنتهي خلال 30 يوم</div><div class="stat-val">${expSoon}</div></div>` : ""}
  `;

  const latest = Object.values(SYS.violations)
    .filter(v => Number(v.amount) > 0)
    .sort((a,b) => (b.date||"").localeCompare(a.date||""))
    .slice(0, 8);

  document.getElementById("dash-vios-tbl").innerHTML = latest.length
    ? latest.map(v => `<tr>
        <td>${v.date||""}</td>
        <td class="car-cell">${v.car||""}</td>
        <td class="driver-cell" style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v.driver||""}</td>
        <td class="money-red">${fmt(v.amount)} ج</td>
      </tr>`).join("")
    : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">لا توجد مخالفات</td></tr>';

  document.getElementById("dash-sups-tbl").innerHTML = Object.keys(SYS.supervisors).length
    ? Object.values(SYS.supervisors).map(s => `<tr>
        <td class="driver-cell">${s.name}</td>
        <td class="money-grn">${fmt(s.custody)} ج</td>
        <td><span class="tag tag-active">نشط</span></td>
      </tr>`).join("")
    : '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:20px">لا يوجد مشرفون</td></tr>';
}

// ======================== Admin: Violations ========================
function adminInsertViolation() {
  const date   = document.getElementById("adm-vio-date").value || today();
  const car    = document.getElementById("adm-vio-car").value.trim();
  const driver = document.getElementById("adm-vio-driver").value.trim();
  const desc   = document.getElementById("adm-vio-desc").value.trim();
  const amount = parseFloat(document.getElementById("adm-vio-amount").value);
  if (!desc || isNaN(amount) || amount < 0) { toast("❌ أدخل البيان والمبلغ!", "err"); return; }
  db.ref("violations").push({ date, car: car || "إدارة", driver: driver || "غير محدد", desc, amount });
  toast("✅ تم إدراج المخالفة", "ok");
  ["adm-vio-car","adm-vio-driver","adm-vio-desc","adm-vio-amount"].forEach(id => document.getElementById(id).value = "");
}

function adminInsertDeduction() {
  const date   = document.getElementById("adm-disc-date").value || today();
  const driver = document.getElementById("adm-disc-driver").value.trim();
  const reason = document.getElementById("adm-disc-reason").value.trim();
  const amount = parseFloat(document.getElementById("adm-disc-amount").value);
  if (!driver || isNaN(amount) || amount <= 0) { toast("❌ أدخل اسم السائق والمبلغ!", "err"); return; }
  db.ref("violations").push({ date, car:"إدارة", driver, desc:"[خصم] " + (reason||""), amount:-Math.abs(amount) });
  toast("✅ تم إدراج الخصم", "ok");
  ["adm-disc-driver","adm-disc-reason","adm-disc-amount"].forEach(id => document.getElementById(id).value = "");
}

// ======================== Admin: Cars ========================
function renderAdminCars() {
  const q = (document.getElementById("cars-search")?.value || "").trim().toLowerCase();
  const entries = Object.entries(SYS.cars).filter(([,c]) => {
    if (!q) return true;
    return (c.id||"").toLowerCase().includes(q) || (c.driverName||"").toLowerCase().includes(q) || (c.company||"").toLowerCase().includes(q);
  });
  const tbody = document.getElementById("adm-cars-tbl");
  tbody.innerHTML = entries.map(([k,c], i) => {
    const days = daysDiff(c.expiry);
    const tag  = days < 0 ? "tag-expired" : days <= 30 ? "tag-soon" : "tag-active";
    const tagT = days < 0 ? "منتهي" : days <= 30 ? `${days} يوم` : "ساري";
    return `<tr>
      <td class="num-cell">${i+1}</td>
      <td class="car-cell" style="font-weight:800">${c.id||""}</td>
      <td>${c.company||""}</td>
      <td class="driver-cell">${c.driverName||"—"}</td>
      <td style="color:#64748b;font-size:.76rem">${c.type||""}</td>
      <td><span class="tag ${tag}">${tagT}</span> <span style="font-size:.75rem;color:#64748b">${c.expiry||""}</span></td>
      <td class="car-cell" style="font-size:.75rem">${c.chassis||""}</td>
      <td>
        <button class="btn btn-sm btn-edit" onclick="editCar('${k}')"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-del"  onclick="confirmDel('car','${k}')"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:24px">${q ? "لا توجد نتائج للبحث" : "لا توجد سيارات — أضف أول سيارة أعلاه"}</td></tr>`;
}

function saveCarData() {
  const uid = document.getElementById("adm-car-uid").value;
  const p = {
    id:         document.getElementById("car-id").value.trim(),
    chassis:    document.getElementById("car-chassis").value.trim(),
    motor:      document.getElementById("car-motor").value.trim(),
    type:       document.getElementById("car-type").value.trim(),
    model:      document.getElementById("car-model").value.trim(),
    expiry:     document.getElementById("car-expiry").value,
    company:    document.getElementById("car-company").value.trim(),
    driverName: document.getElementById("car-driver").value.trim()
  };
  if (!p.id || !p.expiry || !p.company) { toast("❌ أدخل رقم السيارة والشركة وتاريخ الانتهاء!", "err"); return; }
  if (uid) {
    db.ref("cars/" + uid).set(p, () => { toast("✅ تم تحديث السيارة", "ok"); clearCarForm(); });
  } else {
    db.ref("cars").push(p, () => { toast("✅ تمت إضافة السيارة", "ok"); clearCarForm(); });
  }
}

function editCar(key) {
  const c = SYS.cars[key];
  document.getElementById("adm-car-uid").value  = key;
  document.getElementById("car-id").value       = c.id || "";
  document.getElementById("car-chassis").value  = c.chassis || "";
  document.getElementById("car-motor").value    = c.motor || "";
  document.getElementById("car-type").value     = c.type || "";
  document.getElementById("car-model").value    = c.model || "";
  document.getElementById("car-expiry").value   = c.expiry || "";
  document.getElementById("car-company").value  = c.company || "";
  document.getElementById("car-driver").value   = c.driverName || "";
  document.getElementById("car-form-title").textContent = "تعديل بيانات السيارة: " + (c.id||"");
  window.scrollTo({ top:0, behavior:"smooth" });
}

function clearCarForm() {
  ["adm-car-uid","car-id","car-chassis","car-motor","car-type","car-model","car-expiry","car-company","car-driver"]
    .forEach(id => document.getElementById(id).value = "");
  document.getElementById("car-form-title").textContent = "إضافة سيارة جديدة";
}

// ======================== Admin: Licenses ========================
function renderLicenses() {
  const cars  = Object.values(SYS.cars);
  const today = new Date(); today.setHours(0,0,0,0);
  let expired = 0, soon = 0, active = 0;

  const lics = cars.map(c => {
    const exp = c.expiry ? new Date(c.expiry) : null;
    let status = "—", diffDays = null;
    if (exp instanceof Date && !isNaN(exp)) {
      diffDays = Math.ceil((exp - today) / 864e5);
      if      (diffDays < 0)  { status = "منتهي";       expired++; }
      else if (diffDays <= 30){ status = "ينتهي قريباً"; soon++;    }
      else                    { status = "ساري";         active++;  }
    }
    return { ...c, status, diffDays };
  });

  document.getElementById("lic-stats").innerHTML = `
    <div class="stat-card green"><div class="stat-label">تراخيص سارية</div><div class="stat-val">${active}</div></div>
    <div class="stat-card gold"><div class="stat-label">تنتهي قريباً</div><div class="stat-val">${soon}</div></div>
    <div class="stat-card red"><div class="stat-label">تراخيص منتهية</div><div class="stat-val">${expired}</div></div>
    <div class="stat-card blue"><div class="stat-label">إجمالي السيارات</div><div class="stat-val">${cars.length}</div></div>
  `;

  let filtered = LIC_FILTER === "all" ? lics : lics.filter(l => l.status === LIC_FILTER);
  filtered.sort((a,b) => (a.diffDays ?? 9999) - (b.diffDays ?? 9999));

  const grid  = document.getElementById("lic-cards");
  const empty = document.getElementById("lic-empty");
  if (!filtered.length) { grid.innerHTML = ""; empty.style.display = ""; return; }
  empty.style.display = "none";

  grid.innerHTML = filtered.map(l => {
    const cls     = l.status === "منتهي" ? "expired" : l.status === "ينتهي قريباً" ? "soon" : "";
    const expCls  = cls || "ok";
    const tagCls  = expCls === "expired" ? "tag-expired" : expCls === "soon" ? "tag-soon" : "tag-active";
    const daysT   = l.diffDays === null ? "" :
                    l.diffDays < 0  ? `منذ ${Math.abs(l.diffDays)} يوم` :
                    l.diffDays === 0 ? "ينتهي اليوم!" :
                    `باقي ${l.diffDays} يوم`;
    return `<div class="lic-card ${cls}">
      <div class="lic-card-head ${expCls}">
        <div class="lic-car-num">🚗 ${l.id||""}</div>
        <span class="tag ${tagCls}">${l.status}</span>
      </div>
      <div class="lic-card-body">
        ${l.company    ? `<div class="lic-row"><span class="lic-lbl">الشركة</span><span class="lic-val">${l.company}</span></div>` : ""}
        <div class="lic-row"><span class="lic-lbl">السائق</span><span class="lic-val">${l.driverName||"—"}</span></div>
        ${l.type       ? `<div class="lic-row"><span class="lic-lbl">النوع</span><span class="lic-val">${l.type}</span></div>` : ""}
        ${l.chassis    ? `<div class="lic-row"><span class="lic-lbl">شاسيه</span><span class="lic-val" style="font-family:monospace;font-size:.75rem">${l.chassis}</span></div>` : ""}
        <div class="lic-row" style="margin-top:4px">
          <span class="lic-lbl">انتهاء</span>
          <span class="lic-expiry ${expCls}">${l.expiry||"—"}</span>
        </div>
        ${daysT ? `<div style="font-size:.72rem;font-weight:700;color:${expCls==='expired'?'#dc2626':expCls==='soon'?'#d97706':'#16a34a'};margin-top:2px">${daysT}</div>` : ""}
      </div>
    </div>`;
  }).join("");
}

function setLicFilter(f, btn) {
  LIC_FILTER = f;
  document.querySelectorAll(".filter-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderLicenses();
}

// ======================== Admin: Supervisors ========================
function renderAdminSups() {
  const tbody = document.getElementById("adm-sups-tbl");
  const entries = Object.entries(SYS.supervisors);
  tbody.innerHTML = entries.map(([k,s], i) => `
    <tr>
      <td class="num-cell">${i+1}</td>
      <td class="driver-cell">${s.name}</td>
      <td class="car-cell">${s.username||"—"}</td>
      <td class="money-grn">${fmt(s.custody)} ج</td>
      <td>
        <button class="btn btn-sm btn-edit" onclick="editSup('${k}')"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-del"  onclick="confirmDel('supervisor','${k}')"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `).join("") || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:24px">لا يوجد مشرفون بعد</td></tr>';
}

function saveSupervisor() {
  const uid      = document.getElementById("sup-uid").value;
  const name     = document.getElementById("sup-name").value.trim();
  const username = document.getElementById("sup-username").value.trim();
  const password = document.getElementById("sup-password").value;
  const custody  = parseFloat(document.getElementById("sup-custody").value) || 0;
  if (!name) { toast("❌ أدخل اسم المشرف!", "err"); return; }
  if (uid) {
    if (name)     db.ref("supervisors/" + uid + "/name").set(name);
    if (username) db.ref("supervisors/" + uid + "/username").set(username);
    if (password) db.ref("supervisors/" + uid + "/password").set(password);
    if (custody > 0) {
      const cur = Number((SYS.supervisors[uid]||{}).custody || 0);
      db.ref("supervisors/" + uid + "/custody").set(cur + custody);
    }
    toast("✅ تم تحديث بيانات المشرف", "ok");
  } else {
    if (!username || !password) { toast("❌ أدخل اسم المستخدم وكلمة المرور!", "err"); return; }
    db.ref("supervisors").push({ name, username, password, custody });
    toast("✅ تمت إضافة المشرف", "ok");
  }
  clearSupForm();
}

function editSup(key) {
  const s = SYS.supervisors[key];
  document.getElementById("sup-uid").value       = key;
  document.getElementById("sup-name").value      = s.name;
  document.getElementById("sup-username").value  = s.username || "";
  document.getElementById("sup-password").value  = "";
  document.getElementById("sup-custody").value   = "";
  document.getElementById("sup-form-title").textContent = "تعديل بيانات: " + s.name;
  window.scrollTo({ top:0, behavior:"smooth" });
}

function clearSupForm() {
  ["sup-uid","sup-name","sup-username","sup-password","sup-custody"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("sup-form-title").textContent = "تعيين مشرف جديد";
}

// ======================== Admin: Passwords & Config ========================
function updatePass(configKey, inputId) {
  const nw = document.getElementById(inputId).value.trim();
  if (!nw || nw.length < 3) { toast("❌ كلمة المرور قصيرة جداً (3 أحرف على الأقل)!", "err"); return; }
  db.ref("config/" + configKey).set(nw, () => {
    SYS.config[configKey] = nw;
    toast("🔒 تم تحديث كلمة المرور", "ok");
    document.getElementById(inputId).value = "";
  });
}

function updateCustodyAmount() {
  const v = parseFloat(document.getElementById("custody-amt-new").value);
  if (isNaN(v) || v < 0) { toast("❌ أدخل مبلغاً صحيحاً!", "err"); return; }
  db.ref("config/custody").set(v, () => {
    SYS.config.custody = v;
    toast("✅ تم تحديث العهدة الرئيسية", "ok");
    document.getElementById("custody-amt-new").value = "";
  });
}

// ======================== Admin: Invoices Management ========================
function renderAdminInvoices() {
  const statusMap = {
    pending_approval: ["⏳ انتظار",   "tag-pending"],
    approved:         ["✔ معتمدة",    "tag-approved"],
    finalized:        ["✔✔ منتهية",   "tag-finalized"],
    rejected:         ["✘ مرفوضة",   "tag-rejected"]
  };
  const tbody = document.getElementById("adm-invoices-tbl");
  const entries = Object.entries(SYS.invoices).sort((a,b) => (b[1].submittedAt||"").localeCompare(a[1].submittedAt||""));
  tbody.innerHTML = entries.map(([k,inv]) => {
    const total   = invTotal(inv);
    const [sl,cls] = statusMap[inv.status] || [inv.status, ""];
    return `<tr>
      <td class="car-cell">${inv.id||""}</td>
      <td>${inv.date||""}</td>
      <td class="driver-cell">${inv.car||""}</td>
      <td>${inv.supervisorName||""}</td>
      <td class="money-grn">${fmt(total)} ج</td>
      <td><span class="tag ${cls}">${sl}</span></td>
      <td><button class="btn btn-sm btn-del" onclick="confirmDel('invoice','${k}')"><i class="fa-solid fa-trash"></i> حذف</button></td>
    </tr>`;
  }).join("") || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px">لا توجد فواتير</td></tr>';
}

// ======================== Supervisor ========================
function renderSupervisor() {
  if (!currentUser || currentUser.role !== "supervisor") return;
  const sup = SYS.supervisors[currentUser.key];
  if (!sup) { toast("⚠️ لم يتم العثور على بيانات المشرف", "warn"); return; }
  document.getElementById("sup-identity").textContent    = sup.name;
  document.getElementById("sup-custody-lbl").textContent = fmt(sup.custody) + " ج";
  if (!document.getElementById("exp-date").value) document.getElementById("exp-date").value = today();
  renderSupInvoiceHistory();
}

function renderSupInvoiceHistory() {
  if (!currentUser || currentUser.role !== "supervisor") return;
  const statusMap = {
    pending_approval: ["⏳ انتظار",  "tag-pending"],
    approved:         ["✔ معتمدة",  "tag-approved"],
    finalized:        ["✔✔ منتهية", "tag-finalized"],
    rejected:         ["✘ مرفوضة", "tag-rejected"]
  };
  const mine = Object.entries(SYS.invoices)
    .filter(([,inv]) => inv.supervisorKey === currentUser.key)
    .sort((a,b) => (b[1].submittedAt||"").localeCompare(a[1].submittedAt||""));
  document.getElementById("sup-inv-history-tbl").innerHTML = mine.map(([,inv]) => {
    const [sl,cls] = statusMap[inv.status] || [inv.status,""];
    return `<tr>
      <td class="car-cell">${inv.id||""}</td>
      <td class="driver-cell">${inv.car||""}</td>
      <td>${inv.date||""}</td>
      <td class="money-grn">${fmt(invTotal(inv))} ج</td>
      <td><span class="tag ${cls}">${sl}</span></td>
    </tr>`;
  }).join("") || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">لا توجد فواتير سابقة</td></tr>';
}

function createInvoice() {
  if (!currentUser || currentUser.role !== "supervisor") return;
  const date    = document.getElementById("exp-date").value;
  const car     = document.getElementById("exp-car").value.trim();
  const place   = document.getElementById("exp-place").value.trim();
  const licDesc = document.getElementById("exp-license-desc").value.trim();
  const amount  = parseFloat(document.getElementById("exp-amount").value);
  const desc    = document.getElementById("exp-desc").value.trim();
  if (!date || !car || isNaN(amount) || amount <= 0 || !desc) {
    toast("❌ استوفِ جميع الحقول المطلوبة!", "err"); return;
  }
  activeInv = {
    id: "INV-" + Math.floor(100000 + Math.random() * 900000),
    date, car, place, licenseDesc: licDesc,
    supervisorKey:  currentUser.key,
    supervisorName: currentUser.name,
    items: [{ amount, desc }],
    status: "draft"
  };
  document.getElementById("active-invoice-zone").style.display = "";
  document.getElementById("inv-active-id").textContent = activeInv.id;
  renderInvItems();
}

function cancelInvoice() {
  activeInv = null;
  document.getElementById("active-invoice-zone").style.display = "none";
}

function renderInvItems() {
  if (!activeInv) return;
  let total = 0;
  document.getElementById("inv-items-tbl").innerHTML = (activeInv.items||[]).map((item, i) => {
    total += Number(item.amount||0);
    return `<tr>
      <td class="money-grn">${fmt(item.amount)} ج</td>
      <td>${item.desc}</td>
      <td><button class="btn btn-sm btn-del" onclick="removeItem(${i})"><i class="fa-solid fa-trash"></i></button></td>
    </tr>`;
  }).join("") || '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:12px">لا توجد بنود بعد</td></tr>';
  document.getElementById("inv-total").textContent = fmt(total);
}

function appendItem() {
  const amount = parseFloat(document.getElementById("sub-amount").value);
  const desc   = document.getElementById("sub-desc").value.trim();
  if (isNaN(amount) || amount <= 0 || !desc) { toast("❌ أدخل المبلغ والبيان!", "err"); return; }
  if (!activeInv) return;
  activeInv.items.push({ amount, desc });
  document.getElementById("sub-amount").value = "";
  document.getElementById("sub-desc").value   = "";
  document.getElementById("sub-desc").focus();
  renderInvItems();
}

function removeItem(idx) {
  if (!activeInv) return;
  activeInv.items.splice(idx, 1);
  renderInvItems();
}

function submitInvoice() {
  if (!activeInv || !activeInv.items.length) { toast("❌ أضف بنداً واحداً على الأقل!", "err"); return; }
  const total = invTotal(activeInv);
  if (!confirm(`إرسال الفاتورة رقم ${activeInv.id}\nالإجمالي: ${fmt(total)} جنيه\nلاعتماد مدير الحركة؟`)) return;
  activeInv.status      = "pending_approval";
  activeInv.submittedAt = new Date().toISOString();
  activeInv.totalSum    = total;
  db.ref("invoices").push(activeInv, () => {
    toast("✅ تم إرسال الفاتورة بنجاح", "ok");
    cancelInvoice();
    renderSupInvoiceHistory();
  });
}

// ======================== Traffic Manager ========================
function renderTraffic() {
  const pending  = document.getElementById("traffic-pending-tbl");
  const history  = document.getElementById("traffic-history-tbl");
  const emptyEl  = document.getElementById("traffic-empty");
  const countBdg = document.getElementById("traffic-pending-count");
  pending.innerHTML = ""; history.innerHTML = "";
  let cnt = 0;

  Object.entries(SYS.invoices).sort((a,b) => (b[1].submittedAt||"").localeCompare(a[1].submittedAt||"")).forEach(([k,inv]) => {
    const total = invTotal(inv);
    if (inv.status === "pending_approval") {
      cnt++;
      pending.innerHTML += `<tr>
        <td class="car-cell">${inv.id}</td>
        <td>${inv.date}</td>
        <td class="driver-cell">${inv.car}</td>
        <td>${inv.supervisorName||""}</td>
        <td class="money-gold">${fmt(total)} ج</td>
        <td><button class="btn btn-sm btn-outline" onclick="showInvDetails('${k}')"><i class="fa-solid fa-eye"></i> تفاصيل</button></td>
        <td style="display:flex;gap:4px">
          <button class="btn btn-sm btn-green" onclick="approveInv('${k}')"><i class="fa-solid fa-check"></i> اعتماد</button>
          <button class="btn btn-sm btn-del"   onclick="rejectInv('${k}')"><i class="fa-solid fa-xmark"></i> رفض</button>
        </td>
      </tr>`;
    } else {
      const statusMap = { approved:"✔ معتمدة", finalized:"✔✔ منتهية", rejected:"✘ مرفوضة" };
      const tagMap    = { approved:"tag-approved", finalized:"tag-finalized", rejected:"tag-rejected" };
      history.innerHTML += `<tr>
        <td class="car-cell">${inv.id}</td>
        <td>${inv.date}</td>
        <td class="driver-cell">${inv.car}</td>
        <td>${inv.supervisorName||""}</td>
        <td class="money-grn">${fmt(total)} ج</td>
        <td><span class="tag ${tagMap[inv.status]||''}">${statusMap[inv.status]||inv.status}</span></td>
      </tr>`;
    }
  });

  if (countBdg) countBdg.textContent = cnt;
  emptyEl.style.display = cnt ? "none" : "";
}

function approveInv(key) {
  if (!confirm("اعتماد هذه الفاتورة وإرسالها للمدير المالي؟")) return;
  db.ref("invoices/" + key + "/status").set("approved");
  db.ref("invoices/" + key + "/approvedAt").set(new Date().toISOString());
  toast("✅ تم الاعتماد", "ok");
}

function rejectInv(key) {
  if (!confirm("رفض هذه الفاتورة؟")) return;
  db.ref("invoices/" + key + "/status").set("rejected");
  db.ref("invoices/" + key + "/rejectedAt").set(new Date().toISOString());
  toast("تم الرفض", "warn");
}

function showInvDetails(key) {
  const inv   = SYS.invoices[key];
  const total = invTotal(inv);
  document.getElementById("modal-title").textContent = `فاتورة: ${inv.id} — السيارة: ${inv.car}`;
  document.getElementById("modal-body").innerHTML = `
    <div style="margin-bottom:10px;font-size:.8rem;color:#64748b">
      <strong>التاريخ:</strong> ${inv.date||""} &nbsp;|&nbsp;
      <strong>المشرف:</strong> ${inv.supervisorName||""} &nbsp;|&nbsp;
      <strong>المكان:</strong> ${inv.place||"—"}
    </div>
    ${(inv.items||[]).map(item =>
      `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f1f5f9">
        <span>${item.desc}</span>
        <strong class="money-grn">${fmt(item.amount)} ج</strong>
      </div>`
    ).join("")}
    <div style="text-align:left;padding-top:10px;font-weight:800;font-size:.95rem">الإجمالي: <span class="money-grn">${fmt(total)} جنيه</span></div>
  `;
  openModal("modal-details");
}

// ======================== Finance Manager ========================
function renderFinance() {
  const approved = document.getElementById("finance-approved-tbl");
  const hist     = document.getElementById("finance-history-tbl");
  const emptyEl  = document.getElementById("finance-empty");
  const countBdg = document.getElementById("finance-approved-count");
  approved.innerHTML = ""; hist.innerHTML = "";
  let approvedCount = 0;

  Object.entries(SYS.invoices).sort((a,b) => (b[1].submittedAt||"").localeCompare(a[1].submittedAt||"")).forEach(([k,inv]) => {
    const total = invTotal(inv);
    if (inv.status === "approved") {
      approvedCount++;
      approved.innerHTML += `<tr>
        <td class="car-cell">${inv.id}</td>
        <td>${inv.date}</td>
        <td class="driver-cell">${inv.car}</td>
        <td>${inv.supervisorName||""}</td>
        <td style="font-size:.76rem;color:#64748b">${inv.place||""} ${inv.licenseDesc ? "— "+inv.licenseDesc : ""}</td>
        <td class="money-grn" style="font-weight:800">${fmt(total)} ج</td>
        <td><button class="btn btn-sm btn-green" onclick="finalizePrint('${k}')"><i class="fa-solid fa-print"></i> طباعة وخصم</button></td>
      </tr>`;
    } else if (inv.status === "finalized") {
      hist.innerHTML += `<tr>
        <td class="car-cell">${inv.id}</td>
        <td>${inv.date}</td>
        <td class="driver-cell">${inv.car}</td>
        <td>${inv.supervisorName||""}</td>
        <td class="money-grn">${fmt(total)} ج</td>
        <td><button class="btn btn-sm btn-outline" onclick="reprintInv('${k}')"><i class="fa-solid fa-print"></i> إعادة طباعة</button></td>
      </tr>`;
    }
  });

  if (countBdg) countBdg.textContent = approvedCount;
  emptyEl.style.display = approvedCount ? "none" : "";
}

function finalizePrint(key) {
  const inv   = SYS.invoices[key];
  const total = invTotal(inv);
  if (!inv.supervisorKey || !SYS.supervisors[inv.supervisorKey]) {
    toast("❌ لم يتم العثور على بيانات المشرف!", "err"); return;
  }
  const sup = SYS.supervisors[inv.supervisorKey];
  const cur = Number(sup.custody || 0);
  if (cur < total) {
    toast(`❌ عهدة المشرف (${fmt(cur)} ج) غير كافية للخصم (${fmt(total)} ج)!`, "err"); return;
  }
  if (!confirm(`خصم ${fmt(total)} ج من عهدة "${sup.name}"؟\nقبل: ${fmt(cur)} ج  ←  بعد: ${fmt(cur - total)} ج`)) return;

  db.ref("supervisors/" + inv.supervisorKey + "/custody").set(cur - total);
  db.ref("invoices/" + key + "/status").set("finalized");
  db.ref("invoices/" + key + "/finalizedAt").set(new Date().toISOString());
  activeInv = inv;
  lastPrintScreen = "finance";
  triggerPrint(total, sup.name);
}

function reprintInv(key) {
  const inv    = SYS.invoices[key];
  const total  = invTotal(inv);
  const supName = inv.supervisorName || (inv.supervisorKey && SYS.supervisors[inv.supervisorKey] ? SYS.supervisors[inv.supervisorKey].name : "");
  activeInv = inv;
  lastPrintScreen = (currentUser && currentUser.role === "finance") ? "finance" : "reports";
  triggerPrint(total, supName);
}

function triggerPrint(total, supName) {
  document.getElementById("prt-inv-id").textContent      = activeInv.id;
  document.getElementById("prt-date").textContent        = new Date().toLocaleDateString("ar-EG");
  document.getElementById("prt-inv-date").textContent    = activeInv.date;
  document.getElementById("prt-inv-car").textContent     = activeInv.car;
  document.getElementById("prt-inv-place").textContent   = activeInv.place || "مكان الخدمة";
  document.getElementById("prt-inv-license").textContent = activeInv.licenseDesc || "مصاريف عامة";
  document.getElementById("prt-inv-sup").textContent     = supName || activeInv.supervisorName || "";
  document.getElementById("prt-items-tbl").innerHTML     = (activeInv.items||[]).map(item =>
    `<tr>
      <td style="padding:5px 8px;border-bottom:1px solid #d4b896;font-weight:700">${fmt(item.amount)} ج</td>
      <td style="padding:5px 8px;border-bottom:1px solid #d4b896">${item.desc}</td>
    </tr>`
  ).join("");
  document.getElementById("prt-total").textContent = fmt(total) + " جنيه مصري";
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  document.getElementById("print-zone").style.display = "block";
  setTimeout(() => window.print(), 500);
}

function closePrint() {
  document.getElementById("print-zone").style.display = "none";
  if (lastPrintScreen === "finance" && currentUser && currentUser.role === "finance") showScreen("finance");
  else showScreen("reports");
}

// ======================== Manager: General Expenses ========================
function renderManager() {
  renderMgrStats();
  renderMgrExpenses();
  renderMgrAssignSelect();
  renderMgrAssignments();
  renderMgrCards();
  if (!document.getElementById("mgr-exp-date").value)    document.getElementById("mgr-exp-date").value    = today();
  if (!document.getElementById("mgr-assign-date").value) document.getElementById("mgr-assign-date").value = today();
}

function renderMgrStats() {
  const total      = Number(SYS.config.custody || 0);
  const cashSpent  = Object.values(SYS.managerExpenses).filter(e => e.payMethod === "cash").reduce((s,e) => s + Number(e.total||0), 0);
  const visaSpent  = Object.values(SYS.managerExpenses).filter(e => e.payMethod === "visa").reduce((s,e) => s + Number(e.total||0), 0);
  document.getElementById("mgr-stats").innerHTML = `
    <div class="stat-card purple"><div class="stat-label">إجمالي العهدة</div><div class="stat-val">${fmt(total)} ج</div></div>
    <div class="stat-card green"><div class="stat-label">مصروف نقدي</div><div class="stat-val">${fmt(cashSpent)} ج</div></div>
    <div class="stat-card blue"><div class="stat-label">مصروف فيزا</div><div class="stat-val">${fmt(visaSpent)} ج</div></div>
    <div class="stat-card teal"><div class="stat-label">متبقي (نقدي)</div><div class="stat-val">${fmt(total - cashSpent)} ج</div></div>
  `;
}

function calcMgrTotal() {
  const qty   = parseInt(document.getElementById("mgr-exp-qty").value) || 0;
  const price = parseFloat(document.getElementById("mgr-exp-price").value) || 0;
  document.getElementById("mgr-exp-total").textContent = fmt(qty * price);
}

function toggleVisaSelect() {
  const v = document.querySelector('input[name="pay-method"]:checked');
  document.getElementById("mgr-visa-select").style.display = (v && v.value === "visa") ? "" : "none";
}

function addGeneralExpense() {
  const desc      = document.getElementById("mgr-exp-desc").value.trim();
  const qty       = parseInt(document.getElementById("mgr-exp-qty").value) || 0;
  const price     = parseFloat(document.getElementById("mgr-exp-price").value) || 0;
  const date      = document.getElementById("mgr-exp-date").value;
  const payMethod = document.querySelector('input[name="pay-method"]:checked')?.value || "cash";
  const cardId    = payMethod === "visa" ? document.getElementById("mgr-visa-select").value : "";
  if (!desc || qty < 1 || price <= 0 || !date) { toast("❌ استوفِ جميع البيانات!", "err"); return; }
  if (payMethod === "visa" && !cardId) { toast("❌ اختر بطاقة الفيزا!", "err"); return; }
  const cardName = payMethod === "visa" ? ((SYS.managerVisaCards[cardId]||{}).name||"") : "";
  db.ref("managerExpenses").push({
    id: "EXP-" + Date.now(), date, desc, qty, remainingQty:qty,
    unitPrice:price, total:qty*price, payMethod, cardId, cardName
  }, () => {
    toast("✅ تم حفظ المصروف", "ok");
    ["mgr-exp-desc","mgr-exp-qty","mgr-exp-price"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("mgr-exp-total").textContent = "0";
  });
}

function renderMgrExpenses() {
  const tbody = document.getElementById("mgr-exp-tbl");
  tbody.innerHTML = Object.entries(SYS.managerExpenses).map(([k,e]) => {
    const badge = e.payMethod === "cash"
      ? '<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:12px;font-size:.7rem;font-weight:700">💵 نقدي</span>'
      : `<span style="background:#dbeafe;color:#2563eb;padding:2px 8px;border-radius:12px;font-size:.7rem;font-weight:700">💳 ${e.cardName||"فيزا"}</span>`;
    return `<tr>
      <td>${e.date||""}</td>
      <td class="driver-cell">${e.desc}</td>
      <td style="text-align:center">${e.qty}</td>
      <td style="text-align:center;font-weight:700;color:${(e.remainingQty||0) > 0 ? "#d97706":"#94a3b8"}">${e.remainingQty||0}</td>
      <td style="text-align:center">${fmt(e.unitPrice||0)}</td>
      <td class="money-blue" style="text-align:center;font-weight:800;color:#2563eb">${fmt(e.total||0)}</td>
      <td style="text-align:center">${badge}</td>
      <td style="text-align:center"><button class="btn btn-sm btn-del" onclick="confirmDel('expense','${k}')"><i class="fa-solid fa-trash"></i></button></td>
    </tr>`;
  }).join("") || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:20px">لا توجد مصروفات</td></tr>';
}

function renderMgrAssignSelect() {
  const sel = document.getElementById("mgr-assign-exp");
  sel.innerHTML = '<option value="">-- اختر مصروف --</option>';
  Object.entries(SYS.managerExpenses)
    .filter(([,e]) => (e.remainingQty||0) > 0)
    .forEach(([k,e]) => { sel.innerHTML += `<option value="${k}">${e.desc} (متبقي: ${e.remainingQty} — ${fmt(e.unitPrice)} ج)</option>`; });
}

function updateAssignAvail() {
  const key = document.getElementById("mgr-assign-exp").value;
  const exp = SYS.managerExpenses[key];
  document.getElementById("mgr-assign-avail").textContent = exp ? `متاح: ${exp.remainingQty}` : "متاح: —";
}

function assignToCar() {
  const expKey = document.getElementById("mgr-assign-exp").value;
  const carNum = document.getElementById("mgr-assign-car").value.trim();
  const qty    = parseInt(document.getElementById("mgr-assign-qty").value) || 0;
  const date   = document.getElementById("mgr-assign-date").value;
  const exp    = SYS.managerExpenses[expKey];
  if (!expKey || !exp || !carNum || qty < 1 || !date) { toast("❌ استوفِ جميع البيانات!", "err"); return; }
  if (qty > (exp.remainingQty||0)) { toast(`❌ الكمية (${qty}) أكبر من المتاح (${exp.remainingQty})!`, "err"); return; }
  const amount = qty * (exp.unitPrice||0);
  db.ref("managerAssignments").push({ id:"ASN-"+Date.now(), date, expenseId:expKey, expenseDesc:exp.desc, carNum, qty, amount }, () => {
    db.ref("managerExpenses/" + expKey + "/remainingQty").set((exp.remainingQty||0) - qty);
    toast("✅ تم التحميل على السيارة", "ok");
  });
}

function renderMgrAssignments() {
  const tbody = document.getElementById("mgr-assign-tbl");
  tbody.innerHTML = Object.entries(SYS.managerAssignments).map(([k,a]) => `
    <tr>
      <td>${a.date||""}</td>
      <td class="driver-cell">${a.expenseDesc||""}</td>
      <td style="text-align:center;color:#2563eb;font-weight:700">${a.carNum}</td>
      <td style="text-align:center">${a.qty}</td>
      <td class="money-grn" style="font-weight:800">${fmt(a.amount||0)} ج</td>
      <td><button class="btn btn-sm btn-del" onclick="confirmDel('assignment','${k}')"><i class="fa-solid fa-trash"></i></button></td>
    </tr>
  `).join("") || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">لا توجد تحميلات</td></tr>';
}

function renderMgrStatement() {
  const el = document.getElementById("mgr-stmt-content");
  const cashExpenses = Object.values(SYS.managerExpenses).filter(e => e.payMethod === "cash");
  const visaExpenses = Object.values(SYS.managerExpenses).filter(e => e.payMethod === "visa");
  const cashTotal    = cashExpenses.reduce((s,e) => s + Number(e.total||0), 0);
  const visaTotal    = visaExpenses.reduce((s,e) => s + Number(e.total||0), 0);
  const custodyTotal = Number(SYS.config.custody || 0);
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px">
        <div style="font-size:.7rem;font-weight:700;color:#16a34a;margin-bottom:4px">إجمالي المصروفات النقدية</div>
        <div style="font-size:1.5rem;font-weight:800;color:#16a34a">${fmt(cashTotal)} ج</div>
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px">
        <div style="font-size:.7rem;font-weight:700;color:#2563eb;margin-bottom:4px">إجمالي مصروفات الفيزا</div>
        <div style="font-size:1.5rem;font-weight:800;color:#2563eb">${fmt(visaTotal)} ج</div>
      </div>
      <div style="background:#fefce8;border:1px solid #fef08a;border-radius:10px;padding:14px">
        <div style="font-size:.7rem;font-weight:700;color:#d97706;margin-bottom:4px">المتبقي من العهدة</div>
        <div style="font-size:1.5rem;font-weight:800;color:#d97706">${fmt(custodyTotal - cashTotal)} ج</div>
      </div>
      <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:14px">
        <div style="font-size:.7rem;font-weight:700;color:#7c3aed;margin-bottom:4px">إجمالي العهدة</div>
        <div style="font-size:1.5rem;font-weight:800;color:#7c3aed">${fmt(custodyTotal)} ج</div>
      </div>
    </div>
    <div class="tbl-wrap">
      <table><thead><tr><th>التاريخ</th><th>البيان</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>طريقة الدفع</th></tr></thead>
      <tbody>
        ${Object.values(SYS.managerExpenses).map(e => {
          const badge = e.payMethod === "cash"
            ? '<span style="background:#dcfce7;color:#16a34a;padding:2px 7px;border-radius:10px;font-size:.7rem;font-weight:700">💵 نقدي</span>'
            : `<span style="background:#dbeafe;color:#2563eb;padding:2px 7px;border-radius:10px;font-size:.7rem;font-weight:700">💳 ${e.cardName||"فيزا"}</span>`;
          return `<tr><td>${e.date||""}</td><td class="driver-cell">${e.desc}</td><td style="text-align:center">${e.qty}</td><td style="text-align:center">${fmt(e.unitPrice||0)} ج</td><td class="money-blue" style="color:#2563eb;font-weight:800">${fmt(e.total||0)} ج</td><td>${badge}</td></tr>`;
        }).join("") || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:16px">لا توجد مصروفات</td></tr>'}
      </tbody></table>
    </div>
  `;
}

function renderMgrCards() {
  const el = document.getElementById("mgr-cards-list");
  el.innerHTML = Object.entries(SYS.managerVisaCards).map(([k,c]) => `
    <div style="display:flex;justify-content:space-between;align-items:center;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px 14px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:1.3rem">💳</span>
        <div><strong style="font-size:.84rem">${c.name}</strong><span style="color:#94a3b8;font-family:monospace;font-size:.76rem;margin-right:8px">**** ${c.last4}</span></div>
      </div>
      <button class="btn btn-sm btn-del" onclick="confirmDel('card','${k}')"><i class="fa-solid fa-trash"></i></button>
    </div>
  `).join("") || '<p style="text-align:center;color:#94a3b8;padding:16px;font-size:.82rem">لا توجد بطاقات مضافة</p>';

  const sel = document.getElementById("mgr-visa-select");
  sel.innerHTML = '<option value="">-- اختر البطاقة --</option>';
  Object.entries(SYS.managerVisaCards).forEach(([k,c]) => {
    sel.innerHTML += `<option value="${k}">${c.name} (**** ${c.last4})</option>`;
  });
}

function addVisaCard() {
  const name  = document.getElementById("mgr-card-name").value.trim();
  const last4 = document.getElementById("mgr-card-last4").value.trim();
  if (!name) { toast("❌ أدخل اسم البطاقة!", "err"); return; }
  if (last4.length !== 4 || !/^\d{4}$/.test(last4)) { toast("❌ أدخل آخر 4 أرقام صحيحة!", "err"); return; }
  db.ref("managerVisaCards").push({ name, last4 }, () => toast("✅ تمت إضافة البطاقة", "ok"));
  document.getElementById("mgr-card-name").value  = "";
  document.getElementById("mgr-card-last4").value = "";
}

// ======================== Reports ========================
function renderReports() {
  const vioQ  = (document.getElementById("rep-vios-search")?.value    || "").trim().toLowerCase();
  const drvQ  = (document.getElementById("rep-drivers-search")?.value || "").trim().toLowerCase();

  // Violations
  const vios = Object.values(SYS.violations)
    .filter(v => !vioQ || (v.car||"").toLowerCase().includes(vioQ) || (v.driver||"").toLowerCase().includes(vioQ))
    .sort((a,b) => (b.date||"").localeCompare(a.date||""));
  document.getElementById("rep-vios-tbl").innerHTML = vios.map((v,i) =>
    `<tr>
      <td class="num-cell">${i+1}</td>
      <td>${v.date||""}</td>
      <td class="car-cell">${v.car||""}</td>
      <td class="driver-cell">${v.driver||""}</td>
      <td style="font-size:.76rem">${v.desc||""}</td>
      <td class="${Number(v.amount)>=0 ? "money-red":"money-grn"}">${fmt(v.amount)} ج</td>
    </tr>`
  ).join("") || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">لا توجد بيانات</td></tr>';

  // Driver balances
  const balances = calcBalances();
  const drvRows  = Object.values(balances).filter(b => !drvQ || b.driver.toLowerCase().includes(drvQ));
  document.getElementById("rep-drivers-tbl").innerHTML = drvRows.map((b,i) => {
    const net = b.totalVios - b.totalDiscounts;
    return `<tr>
      <td class="num-cell">${i+1}</td>
      <td class="driver-cell">${b.driver}</td>
      <td class="money-red">${fmt(b.totalVios)} ج</td>
      <td class="money-grn">${fmt(b.totalDiscounts)} ج</td>
      <td class="${net>0?"money-gold":""}" style="font-weight:800">${fmt(net)} ج</td>
    </tr>`;
  }).join("") || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">لا توجد بيانات</td></tr>';

  // Licenses
  const licRows = Object.values(SYS.cars).sort((a,b) => (a.expiry||"").localeCompare(b.expiry||""));
  document.getElementById("rep-licenses-tbl").innerHTML = licRows.map((c,i) => {
    const d   = daysDiff(c.expiry);
    const cls = d < 0 ? "money-red" : d <= 30 ? "money-gold" : "money-grn";
    return `<tr>
      <td class="num-cell">${i+1}</td>
      <td class="car-cell" style="font-weight:800">${c.id||""}</td>
      <td>${c.company||""}</td>
      <td class="driver-cell">${c.driverName||"—"}</td>
      <td>${c.expiry||""}</td>
      <td class="${cls}" style="font-weight:800">${d === 9999 ? "—" : d + " يوم"}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">لا توجد سيارات</td></tr>';

  // Invoices
  const stMap  = { pending_approval:"⏳ انتظار", approved:"✔ معتمدة", finalized:"✔✔ منتهية", rejected:"✘ مرفوضة" };
  const clsMap = { pending_approval:"tag-pending", approved:"tag-approved", finalized:"tag-finalized", rejected:"tag-rejected" };
  const invRows = Object.entries(SYS.invoices).sort((a,b) => (b[1].submittedAt||"").localeCompare(a[1].submittedAt||""));
  document.getElementById("rep-invoices-tbl").innerHTML = invRows.map(([k,inv]) => {
    const total = invTotal(inv);
    return `<tr>
      <td class="car-cell">${inv.id}</td>
      <td>${inv.date}</td>
      <td class="driver-cell">${inv.car}</td>
      <td>${inv.supervisorName||""}</td>
      <td class="money-grn">${fmt(total)} ج</td>
      <td><span class="tag ${clsMap[inv.status]||''}">${stMap[inv.status]||inv.status}</span></td>
      <td>${inv.status==="finalized" ? `<button class="btn btn-sm btn-outline" onclick="reprintInv('${k}')"><i class="fa-solid fa-print"></i></button>` : ""}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:20px">لا توجد فواتير</td></tr>';

  // Statement select
  const sel = document.getElementById("stmt-sup-select");
  const cur  = sel.value;
  sel.innerHTML = '<option value="">-- اختر المشرف --</option>' +
    Object.entries(SYS.supervisors).map(([k,s]) => `<option value="${k}" ${k===cur?"selected":""}>${s.name}</option>`).join("");
  if (cur) renderStatement();
}

function renderStatement() {
  const key   = document.getElementById("stmt-sup-select").value;
  const tbody = document.getElementById("rep-stmt-tbl");
  const sumEl = document.getElementById("stmt-summary");
  if (!key) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">اختر مشرفاً</td></tr>';
    if (sumEl) sumEl.textContent = "";
    return;
  }
  const stMap  = { pending_approval:"⏳ انتظار", approved:"✔ معتمدة", finalized:"✔✔ منتهية", rejected:"✘ مرفوضة" };
  const mine   = Object.entries(SYS.invoices)
    .filter(([,inv]) => inv.supervisorKey === key)
    .sort((a,b) => (b[1].submittedAt||"").localeCompare(a[1].submittedAt||""));
  let grandTotal = 0;
  tbody.innerHTML = mine.map(([,inv]) => {
    const total = invTotal(inv);
    if (inv.status === "finalized") grandTotal += total;
    return `<tr>
      <td>${inv.date||""}</td>
      <td class="car-cell">${inv.id}</td>
      <td class="driver-cell">${inv.car}</td>
      <td style="font-size:.76rem">${inv.place||""} ${inv.licenseDesc ? "— "+inv.licenseDesc : ""}</td>
      <td class="money-red">-${fmt(total)} ج</td>
      <td>${stMap[inv.status]||inv.status}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">لا توجد فواتير لهذا المشرف</td></tr>';
  if (sumEl) sumEl.textContent = mine.length ? `إجمالي المصروف: ${fmt(grandTotal)} ج` : "";
}

// ======================== Driver Balances ========================
function calcBalances() {
  const bal = {};
  Object.values(SYS.violations).forEach(v => {
    if (!v.driver) return;
    if (!bal[v.driver]) bal[v.driver] = { driver:v.driver, totalVios:0, totalDiscounts:0 };
    if (Number(v.amount) >= 0) bal[v.driver].totalVios      += Number(v.amount);
    else                       bal[v.driver].totalDiscounts += Math.abs(Number(v.amount));
  });
  return bal;
}

function renderAdminBalances() {
  const q      = (document.getElementById("bal-search")?.value || "").trim().toLowerCase();
  const tbody  = document.getElementById("adm-balances-tbl");
  const bal    = calcBalances();
  const rows   = Object.values(bal).filter(b => !q || b.driver.toLowerCase().includes(q));
  tbody.innerHTML = rows.map((b,i) => {
    const net = b.totalVios - b.totalDiscounts;
    return `<tr>
      <td class="num-cell">${i+1}</td>
      <td class="driver-cell">${b.driver}</td>
      <td class="money-red">${fmt(b.totalVios)} ج</td>
      <td class="money-grn">${fmt(b.totalDiscounts)} ج</td>
      <td class="${net>0?"money-gold":""}" style="font-weight:800">${fmt(net)} ج</td>
      <td><button class="btn btn-sm btn-green" onclick="applyDriverDiscount('${b.driver}')">خصم</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">${q?"لا توجد نتائج":"لا توجد بيانات"}</td></tr>`;
}

function applyDriverDiscount(driver) {
  const amt = prompt(`أدخل مبلغ الخصم للسائق "${driver}":`);
  if (!amt || isNaN(amt) || Number(amt) <= 0) return;
  db.ref("violations").push({ date:today(), car:"إدارة", driver, desc:"[خصم مالي]", amount:-Math.abs(Number(amt)) });
  toast("✅ تم الخصم", "ok");
}

// ======================== CSV / Excel Import ========================
function importCSV(event, type) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    let count = 0;
    if (file.name.match(/\.xlsx?$/i)) {
      const wb  = XLSX.read(new Uint8Array(e.target.result), { type:"array" });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval:"" });
      json.forEach(row => {
        const v = Object.values(row).map(String);
        if (type==="cars"       && v.length>=7) { db.ref("cars").push({ id:v[0], chassis:v[1], motor:v[2], type:v[3], model:v[4], expiry:v[5], company:v[6], driverName:v[7]||"" }); count++; }
        else if (type==="violations" && v.length>=4) { db.ref("violations").push({ date:v[0], car:v[1], driver:v[2], desc:v[3], amount:parseFloat(v[4]||0) }); count++; }
        else if (type==="discounts"  && v.length>=3) { db.ref("violations").push({ date:v[0]||today(), car:"إدارة", driver:v[1], desc:"[خصم مستورد]: "+v[2], amount:-Math.abs(parseFloat(v[3]||0)) }); count++; }
      });
    } else {
      const lines = e.target.result.split("\n");
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const c = lines[i].split(",").map(x => x.trim().replace(/^"|"$/g,""));
        if (type==="cars"       && c.length>=7) { db.ref("cars").push({ id:c[0], chassis:c[1], motor:c[2], type:c[3], model:c[4], expiry:c[5], company:c[6], driverName:c[7]||"" }); count++; }
        else if (type==="violations" && c.length>=4) { db.ref("violations").push({ date:c[0], car:c[1], driver:c[2], desc:c[3], amount:parseFloat(c[4]||0) }); count++; }
        else if (type==="discounts"  && c.length>=3) { db.ref("violations").push({ date:c[0]||today(), car:"إدارة", driver:c[1], desc:"[خصم مستورد]: "+c[2], amount:-Math.abs(parseFloat(c[3]||0)) }); count++; }
      }
    }
    toast(`✅ تم استيراد ${count} سجل بنجاح`, "ok");
    event.target.value = "";
  };
  if (file.name.match(/\.xlsx?$/i)) reader.readAsArrayBuffer(file);
  else                               reader.readAsText(file, "utf-8");
}

function downloadTemplate(type) {
  let csv = "\uFEFF";
  if (type==="cars")       csv += "رقم_السيارة,الشاسيه,الموتور,النوع,الموديل,تاريخ_انتهاء_الترخيص,الشركة,اسم_السائق\n8245,SH10245,M9082,جامبو,2023,2026-12-31,مصر للنوربات,اسم السائق";
  else if (type==="violations") csv += "التاريخ,رقم_السيارة,اسم_السائق,بيان_المخالفة,المبلغ\n2026-01-15,8245,اسم السائق,رادار سرعة,700";
  else if (type==="discounts")  csv += "التاريخ,اسم_السائق,سبب_الخصم,مبلغ_الخصم\n2026-01-15,اسم السائق,خصم شهري,200";
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  a.download = { cars:"قالب_السيارات", violations:"قالب_المخالفات", discounts:"قالب_الخصومات" }[type] + ".csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ======================== Confirm Delete ========================
function confirmDel(type, key) {
  confirmCb = () => {
    const paths = {
      car:        "cars/"                + key,
      supervisor: "supervisors/"         + key,
      expense:    "managerExpenses/"     + key,
      assignment: "managerAssignments/"  + key,
      card:       "managerVisaCards/"    + key,
      invoice:    "invoices/"            + key
    };
    if (paths[type]) db.ref(paths[type]).set(null, () => { toast("🗑 تم الحذف", "ok"); });
  };
  openModal("modal-confirm");
}

function confirmAction() {
  if (confirmCb) confirmCb();
  confirmCb = null;
  closeModal("modal-confirm");
}

// ======================== Firebase Backup / Restore ========================
function exportFirebaseBackup() {
  setStatus("loading", "جاري تصدير البيانات...");
  db.ref("/").once("value", snap => {
    const data = snap.val();
    if (!data) { toast("لا توجد بيانات للتصدير", "warn"); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = "backup_el_banna_" + today() + ".json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setStatus("ok", "تم التصدير");
    toast("✅ تم تصدير النسخة الاحتياطية", "ok");
  });
}

function importFirebaseBackup(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || typeof data !== "object") throw new Error("الملف غير صالح");
      if (!confirm("⚠️ سيتم استبدال كل البيانات الحالية!\nهل أنت متأكد؟")) return;
      setStatus("loading", "جاري الاسترجاع...");
      db.ref("/").set(data, () => {
        setStatus("ok", "تم الاسترجاع بنجاح");
        toast("✅ تم استرجاع البيانات", "ok");
      });
    } catch(err) {
      setStatus("err", "خطأ في الملف");
      toast("❌ خطأ: " + err.message, "err");
    }
  };
  reader.readAsText(file);
  input.value = "";
}

// ======================== Import All Preloaded Data ========================
function importAllPreloadedData() {
  if (!confirm("سيتم استيراد جميع البيانات الأساسية إلى Firebase.\nستُضاف البيانات الجديدة بجانب البيانات الموجودة.\nهل تريد المتابعة؟")) return;
  setStatus("loading", "جاري الاستيراد...");
  toast("⏳ جاري الاستيراد...", "warn", 8000);
  let done = 0;
  const total = PRELOADED_LICENSES.length + PRELOADED_VIOLATIONS.length + PRELOADED_DEDUCTIONS.length;

  // Import licenses as cars
  PRELOADED_LICENSES.forEach(lic => {
    db.ref("cars").push({
      id: lic.carNumber, company: lic.company, type: lic.carType,
      chassis: lic.chassis, motor: lic.motor, driverName: lic.driver, expiry: lic.expiry
    }, () => { done++; if (done >= total) finish(); });
  });

  // Import violations
  PRELOADED_VIOLATIONS.forEach(v => {
    db.ref("violations").push({ date:v.date, car:v.car, driver:v.driver, desc:v.desc, amount:v.amount },
      () => { done++; if (done >= total) finish(); });
  });

  // Import deductions
  PRELOADED_DEDUCTIONS.forEach(d => {
    db.ref("violations").push({ date:d.date, car:"إدارة", driver:d.driver, desc:"[خصم]: "+d.type, amount:-Math.abs(d.amount) },
      () => { done++; if (done >= total) finish(); });
  });

  function finish() {
    setStatus("ok", `تم استيراد ${total} سجل`);
    toast(`✅ تم استيراد ${total} سجل بنجاح`, "ok", 5000);
  }
}

// ======================== Helpers ========================
function daysDiff(d) {
  if (!d) return 9999;
  return Math.ceil((new Date(d) - new Date()) / 864e5);
}
function invTotal(inv) {
  return Number(inv.totalSum) || (inv.items||[]).reduce((s,i) => s + Number(i.amount||0), 0);
}
function fmt(n) { return Number(n||0).toLocaleString("ar-EG", { maximumFractionDigits:0 }); }
function today() { return new Date().toISOString().split("T")[0]; }
function openModal(id)  { const el = document.getElementById(id); if (el) el.classList.add("open"); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.remove("open"); }

// Close modal on backdrop click
document.querySelectorAll(".backdrop").forEach(b => b.addEventListener("click", e => { if (e.target === b) b.classList.remove("open"); }));

// Toast notification
let toastTimer;
function toast(msg, type, duration) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className   = "show" + (type ? " " + type : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = "", duration || 3200);
}

// Status bar
function setStatus(type, msg) {
  const dot = document.getElementById("status-dot");
  const txt = document.getElementById("status-txt");
  if (dot) dot.className  = "status-dot " + type;
  if (txt) txt.textContent = msg;
}

// Auto-logout after 30 minutes of inactivity
function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (currentUser) { doLogout(); alert("⏱️ تم الخروج التلقائي بسبب الخمول (30 دقيقة)."); }
  }, 30 * 60 * 1000);
}
["click","keydown","touchstart","scroll"].forEach(ev => document.addEventListener(ev, resetIdle, { passive:true }));

// Enter key on login
document.addEventListener("DOMContentLoaded", () => {
  const todayVal = today();
  // Pre-fill date fields if they exist
  ["adm-vio-date","adm-disc-date"].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = todayVal;
  });
});


// ============================================================
//  PRE-LOADED DATA (من Google Sheets)
// ============================================================

const PRELOADED_VIOLATIONS = [
  { date:"2025-12-23", driver:"عادل عبدالنبى عبدالحميد الحلبى",          car:"8245",  desc:"حزام امان",                                        amount:400  },
  { date:"2025-09-20", driver:"عمر محمد حسن كمال عمر",                   car:"1928",  desc:"سرعة",                                              amount:700  },
  { date:"2025-11-23", driver:"احمد سعيد احمد حسن",                       car:"7961",  desc:"حزام",                                              amount:200  },
  { date:"2025-10-09", driver:"احمد سعيد احمد حسن",                       car:"7642",  desc:"سرعة",                                              amount:700  },
  { date:"2025-11-17", driver:"احمد سعيد احمد حسن",                       car:"7642",  desc:"سرعة",                                              amount:700  },
  { date:"2025-11-12", driver:"احمد شريف احمد عبدالرازق",                 car:"2591",  desc:"سرعة",                                              amount:700  },
  { date:"2025-05-10", driver:"محمد صبرى نبوى ابراهيم",                   car:"7684",  desc:"سرعة",                                              amount:700  },
  { date:"2025-07-20", driver:"محمد صبرى نبوى ابراهيم",                   car:"7684",  desc:"سرعة",                                              amount:700  },
  { date:"2025-07-31", driver:"محمد صبرى نبوى ابراهيم",                   car:"7684",  desc:"سرعة",                                              amount:700  },
  { date:"2025-10-20", driver:"محمد صبرى نبوى ابراهيم",                   car:"7684",  desc:"سرعة",                                              amount:700  },
  { date:"2025-09-21", driver:"اسلام محمد سيد محمد",                      car:"7684",  desc:"سرعة",                                              amount:700  },
  { date:"2025-11-15", driver:"عبدالرحمن ايمن احمد عزب",                  car:"7684",  desc:"استخدام التليفون",                                  amount:200  },
  { date:"2025-11-16", driver:"عبدالرحمن ايمن احمد عزب",                  car:"7684",  desc:"سرعة",                                              amount:700  },
  { date:"2026-01-20", driver:"محمود عطيه ابراهيم محمد الشاذلى",          car:"9124",  desc:"سرعة",                                              amount:2800 },
  { date:"2026-01-20", driver:"احمد شريف احمد عبدالرازق",                 car:"2591",  desc:"سرعة",                                              amount:400  },
  { date:"2026-01-20", driver:"احمد عبدالعليم محمد طه عريبه",             car:"2591",  desc:"سرعة",                                              amount:700  },
  { date:"2026-01-20", driver:"احمد عبدالعليم محمد طه عريبه",             car:"9283",  desc:"سرعة",                                              amount:700  },
  { date:"2026-01-20", driver:"احمد عبدالعليم محمد طه عريبه",             car:"9283",  desc:"حزام",                                              amount:200  },
  { date:"2026-01-20", driver:"احمد عبدالعليم محمد طه عريبه",             car:"9283",  desc:"تليفون",                                            amount:200  },
  { date:"2025-11-12", driver:"هشام حمدان حسن نصار",                      car:"1273",  desc:"عدم اتباع تعليمات",                                 amount:1200 },
  { date:"2025-10-06", driver:"هشام حمدان حسن نصار",                      car:"1273",  desc:"سرعة",                                              amount:700  },
  { date:"2025-10-21", driver:"هشام حمدان حسن نصار",                      car:"1273",  desc:"تليفون",                                            amount:200  },
  { date:"2025-11-22", driver:"هشام حمدان حسن نصار",                      car:"1273",  desc:"سرعة",                                              amount:700  },
  { date:"2025-12-01", driver:"هشام حمدان حسن نصار",                      car:"1273",  desc:"سرعة",                                              amount:700  },
  { date:"2026-01-20", driver:"محمد احمد حسانين السيد",                   car:"5724",  desc:"سرعة (11)",                                         amount:7700 },
  { date:"2026-01-20", driver:"محمد احمد حسانين السيد",                   car:"5724",  desc:"حزام (7)",                                          amount:1400 },
  { date:"2026-01-20", driver:"عادل عبدالنبى عبدالحميد الحلبى",          car:"8245",  desc:"سرعة (4)",                                          amount:2800 },
  { date:"2026-01-20", driver:"محمد السيد يحيى حسن",                      car:"5468",  desc:"سرعة (7)",                                          amount:4900 },
  { date:"2026-01-20", driver:"محمد السيد يحيى حسن",                      car:"5468",  desc:"حزام",                                              amount:200  },
  { date:"2026-01-20", driver:"السيد ابراهيم عسران حفنى",                 car:"8265",  desc:"سرعة",                                              amount:700  },
  { date:"2026-01-20", driver:"النطرون",                                   car:"1215",  desc:"سرعة (2)",                                          amount:1400 },
  { date:"2026-01-20", driver:"دياب اسماعيل عبد اللطيف محمود الجبالي",   car:"2781",  desc:"سرعة (3)",                                          amount:1500 },
  { date:"2025-08-04", driver:"محمد ابراهيم احمد عوض",                   car:"2591",  desc:"سرعة (1)",                                          amount:700  },
  { date:"2025-08-04", driver:"ابراهيم فتحى محمد محمد البواب",            car:"2591",  desc:"حزام",                                              amount:200  },
  { date:"2025-08-04", driver:"خالد محمد ابوالنجا محمد",                  car:"2198",  desc:"سرعة (6)",                                          amount:3900 },
  { date:"2025-08-04", driver:"محمد عبدالله محمد عبدالوهاب",              car:"1566",  desc:"سرعة (2)",                                          amount:1400 },
  { date:"2025-12-21", driver:"عادل رشوان",                               car:"7385",  desc:"حزام",                                              amount:200  },
  { date:"2025-08-24", driver:"عمرو لينا",                                car:"7385",  desc:"حزام",                                              amount:200  },
  { date:"2025-07-02", driver:"دياب اسماعيل عبد اللطيف محمود الجبالي",   car:"6538",  desc:"سرعة",                                              amount:400  },
  { date:"2025-07-03", driver:"محيي الدين علي عبد الحميد غنيم",          car:"6538",  desc:"سرعة",                                              amount:700  },
  { date:"2025-07-06", driver:"محيي الدين علي عبد الحميد غنيم",          car:"6538",  desc:"سرعة",                                              amount:700  },
  { date:"2025-09-20", driver:"محيي الدين علي عبد الحميد غنيم",          car:"6538",  desc:"سرعة",                                              amount:700  },
  { date:"2025-10-06", driver:"محيي الدين علي عبد الحميد غنيم",          car:"6538",  desc:"سرعة",                                              amount:700  },
  { date:"2025-12-17", driver:"محيي الدين علي عبد الحميد غنيم",          car:"6538",  desc:"سرعة",                                              amount:700  },
  { date:"2025-12-21", driver:"لينا",                                     car:"3526",  desc:"سرعة",                                              amount:400  },
  { date:"2025-11-06", driver:"عصام سعيد عبدالصادق حسن",                 car:"3481",  desc:"حزام",                                              amount:200  },
  { date:"2025-10-06", driver:"خالد محمود",                               car:"7642",  desc:"سرعة",                                              amount:700  },
  { date:"2025-11-17", driver:"خالد محمود",                               car:"7642",  desc:"سرعة",                                              amount:700  },
  { date:"2025-08-07", driver:"احمد شاكر السيد ابراهيم",                  car:"1358",  desc:"سرعة",                                              amount:400  },
  { date:"2025-09-09", driver:"احمد شاكر السيد ابراهيم",                  car:"1358",  desc:"سرعة",                                              amount:700  },
  { date:"2025-10-09", driver:"احمد شاكر السيد ابراهيم",                  car:"1358",  desc:"سرعة",                                              amount:700  },
  { date:"2025-10-01", driver:"سليمان مرغنى عبدالله سليمان",              car:"2547",  desc:"سرعة",                                              amount:700  },
  { date:"2025-11-08", driver:"سليمان مرغنى عبدالله سليمان",              car:"2547",  desc:"سرعة",                                              amount:700  },
  { date:"2026-01-04", driver:"سامح صلاح امين غريب",                      car:"1928",  desc:"سرعة",                                              amount:700  },
  { date:"2025-10-16", driver:"عمر محمد حسن كمال عمر",                   car:"1928",  desc:"سرعة",                                              amount:700  },
  { date:"2025-10-01", driver:"حازم محمد محمد ابراهيم",                   car:"8562",  desc:"سرعة",                                              amount:700  },
  { date:"2025-10-12", driver:"حازم محمد محمد ابراهيم",                   car:"8562",  desc:"سرعة",                                              amount:700  },
  { date:"2025-12-08", driver:"حازم محمد محمد ابراهيم",                   car:"8562",  desc:"سرعة",                                              amount:700  },
  { date:"2026-02-20", driver:"علاء محمد محمد النحاس",                    car:"1278",  desc:"سرعة الاقليمى (3 مخالفات)",                        amount:1800 },
  { date:"2026-02-20", driver:"علاء محمد محمد النحاس",                    car:"1278",  desc:"حزام (3 مخالفات)",                                  amount:600  },
  { date:"2025-12-13", driver:"محمد حسين عبدالفتاح حسين",                 car:"4616",  desc:"مخالفة سرعة الطريق الاقليمى",                      amount:400  },
  { date:"2026-02-10", driver:"عمر محمد حسن كمال عمر",                   car:"1579",  desc:"متحرك 3 الطريق الاقليمى — سرعة",                   amount:700  },
  { date:"2026-03-24", driver:"سعيد محمد شوقى",                           car:"2547",  desc:"سرعة الاقليمى",                                    amount:700  },
  { date:"2026-04-03", driver:"حازم محمد محمد ابراهيم",                   car:"8562",  desc:"متحرك 3 الطريق الاقليمى 4",                        amount:700  },
  { date:"2026-03-08", driver:"حازم محمد محمد ابراهيم",                   car:"8562",  desc:"متحرك طريق اسكندرية الصحرواى",                     amount:700  },
  { date:"2026-04-14", driver:"حازم محمد محمد ابراهيم",                   car:"8562",  desc:"متحرك 3 الطريق الاقليمى 4",                        amount:700  },
  { date:"2026-04-14", driver:"دياب اسماعيل عبد اللطيف محمود الجبالي",   car:"8562",  desc:"متحرك 3 الطريق الاقليمى 4",                        amount:700  },
  { date:"2026-02-23", driver:"السيد ابراهيم عسران حفنى",                 car:"8265",  desc:"القاهرة الاسكندرية الصحرواى — سرعة",               amount:700  },
  { date:"2026-03-19", driver:"السيد ابراهيم عسران حفنى",                 car:"8265",  desc:"طريق القاهرة الاسكندرية الصحرواى — سرعة",          amount:700  },
  { date:"2026-03-21", driver:"محمد احمد حسانين السيد",                   car:"8265",  desc:"متحرك اسكندرية الصحرواوى",                         amount:700  },
  { date:"2026-03-25", driver:"السيد ابراهيم عسران حفنى",                 car:"8265",  desc:"طريق القاهرة الاسكندرية الصحرواى — سرعة",          amount:700  },
  { date:"2026-04-10", driver:"السيد ابراهيم عسران حفنى",                 car:"8265",  desc:"الطريق الدائرى نفق السلام",                        amount:700  },
  { date:"2026-02-17", driver:"محمد ابراهيم حسن موسى",                   car:"6814",  desc:"متحرك طريق اسكندرية الصحرواى",                     amount:700  },
  { date:"2026-04-07", driver:"محمد ابراهيم حسن موسى",                   car:"6814",  desc:"متحرك 3 الطريق الاقليمى 4",                        amount:700  },
  { date:"2026-01-01", driver:"يحيى البدرى",                              car:"5734",  desc:"حزام امان",                                         amount:200  },
  { date:"2026-01-29", driver:"يحيى البدرى",                              car:"5734",  desc:"الطريق الاقليمى — سرعة",                           amount:400  },
  { date:"2026-01-23", driver:"احمد محمود عبدالخالق",                     car:"5723",  desc:"متحرك 3 الطريق الاقليمى 4",                        amount:700  },
  { date:"2026-01-26", driver:"احمد محمود عبدالخالق",                     car:"5723",  desc:"متحرك 3 الطريق الاقليمى 4",                        amount:700  },
  { date:"2026-04-06", driver:"احمد محمود عبدالخالق",                     car:"5723",  desc:"متحرك طريق اسكندرية الصحرواى",                     amount:700  },
  { date:"2026-04-10", driver:"احمد محمود عبدالخالق",                     car:"5723",  desc:"متحرك 3 الطريق الاقليمى 4",                        amount:700  },
  { date:"2026-02-06", driver:"محمد احمد حسانين السيد",                   car:"5724",  desc:"متحرك طريق بلبيس الصحرواى",                        amount:700  },
  { date:"2026-02-21", driver:"محمد احمد حسانين السيد",                   car:"5724",  desc:"بلبيس الزقازيق (حزام امان)",                       amount:200  },
  { date:"2026-03-24", driver:"محمد احمد حسانين السيد",                   car:"5724",  desc:"متحرك 1 الطريق الاقليمى 4",                        amount:700  },
  { date:"2026-04-08", driver:"محيي الدين علي عبد الحميد غنيم",          car:"2547",  desc:"متحرك 3 الطريق الاقليمى 4",                        amount:700  },
  { date:"2026-04-16", driver:"محيي الدين علي عبد الحميد غنيم",          car:"2547",  desc:"متحرك 3 الطريق الاقليمى 4",                        amount:700  },
  { date:"2026-01-01", driver:"عادل عبدالنبى عبدالحميد الحلبى",          car:"8245",  desc:"سرعة",                                              amount:700  },
  { date:"2025-12-05", driver:"احمد عبدالله",                             car:"9386",  desc:"ردار متحرك طريق اسكندرية الصحراوى",                amount:700  },
  { date:"2026-04-22", driver:"احمد عبدالله",                             car:"9386",  desc:"متحرك 3 الطريق الاقليمي 4",                        amount:700  },
  { date:"2026-03-29", driver:"ايهاب السيد",                              car:"1928",  desc:"طريق بلبيس — حزام امان",                           amount:200  },
  { date:"2026-05-13", driver:"محمد احمد حسانين السيد",                   car:"5724",  desc:"متحرك 3 الطريق الاقليمي 4 — سرعة",                amount:700  },
  { date:"2026-05-07", driver:"محى الدين",                                car:"2547",  desc:"ردار متحرك طريق الاسكندريه الصحرواى",              amount:700  },
  { date:"2026-05-13", driver:"محى الدين",                                car:"2547",  desc:"متحرك 3 الطريق الاقليمى 4",                        amount:700  }
];

const PRELOADED_DEDUCTIONS = [
  { date:"2026-01-19", driver:"محمد احمد حسانين السيد",         amount:200, type:"حزام امان" },
  { date:"2026-01-20", driver:"محمد احمد حسانين السيد",         amount:200, type:"حزام امان" },
  { date:"2026-01-01", driver:"محمد صبرى نبوى ابراهيم",         amount:200, type:"حزام امان" },
  { date:"2026-01-15", driver:"سليمان مرغنى عبدالله سليمان",    amount:50,  type:"حزام امان" },
  { date:"2026-01-22", driver:"سليمان مرغنى عبدالله سليمان",    amount:200, type:"حزام امان" },
  { date:"2026-01-27", driver:"سليمان مرغنى عبدالله سليمان",    amount:200, type:"حزام امان" },
  { date:"2026-02-21", driver:"محمد احمد حسانين السيد",         amount:200, type:"حزام امان" },
  { date:"2026-02-20", driver:"محمد احمد حسانين السيد",         amount:200, type:"حزام امان" },
  { date:"2026-03-11", driver:"سليمان مرغنى عبدالله سليمان",    amount:150, type:"حزام امان" },
  { date:"2026-02-21", driver:"محمد صبرى نبوى ابراهيم",         amount:200, type:"حزام امان" },
  { date:"2026-03-16", driver:"محمد صبرى نبوى ابراهيم",         amount:150, type:"حزام امان" },
  { date:"2026-03-12", driver:"محمد صبرى نبوى ابراهيم",         amount:100, type:"حزام امان" },
  { date:"2026-03-22", driver:"محمد صبرى نبوى ابراهيم",         amount:100, type:"حزام امان" },
  { date:"2026-02-18", driver:"محمد صبرى نبوى ابراهيم",         amount:150, type:"حزام امان" },
  { date:"2026-01-19", driver:"محمد صبرى نبوى ابراهيم",         amount:150, type:"حزام امان" },
  { date:"2026-01-21", driver:"محمد صبرى نبوى ابراهيم",         amount:150, type:"حزام امان" },
  { date:"2026-01-26", driver:"محمد صبرى نبوى ابراهيم",         amount:200, type:"حزام امان" },
  { date:"2026-02-13", driver:"محمد صبرى نبوى ابراهيم",         amount:100, type:"حزام امان" },
  { date:"2026-02-17", driver:"محمد صبرى نبوى ابراهيم",         amount:100, type:"حزام امان" },
  { date:"2026-02-20", driver:"محمد صبرى نبوى ابراهيم",         amount:200, type:"حزام امان" },
  { date:"2026-03-03", driver:"محمد صبرى نبوى ابراهيم",         amount:200, type:"حزام امان" },
  { date:"2026-03-04", driver:"محمد صبرى نبوى ابراهيم",         amount:200, type:"حزام امان" },
  { date:"2026-03-17", driver:"محمد صبرى نبوى ابراهيم",         amount:200, type:"حزام امان" },
  { date:"2026-04-06", driver:"محمد صبرى نبوى ابراهيم",         amount:200, type:"حزام امان" },
  { date:"2026-02-01", driver:"سليمان مرغنى عبدالله سليمان",    amount:200, type:"حزام امان" },
  { date:"2026-03-01", driver:"سليمان مرغنى عبدالله سليمان",    amount:150, type:"حزام امان" },
  { date:"2026-03-04", driver:"سليمان مرغنى عبدالله سليمان",    amount:200, type:"حزام امان" },
  { date:"2026-03-17", driver:"سليمان مرغنى عبدالله سليمان",    amount:200, type:"حزام امان" },
  { date:"2026-04-20", driver:"سليمان مرغنى عبدالله سليمان",    amount:200, type:"حزام امان" },
  { date:"2026-05-08", driver:"سليمان مرغنى عبدالله سليمان",    amount:100, type:"حزام امان" },
  { date:"2026-04-13", driver:"سليمان مرغنى عبدالله سليمان",    amount:200, type:"حزام امان" },
  { date:"2026-04-07", driver:"سليمان مرغنى عبدالله سليمان",    amount:150, type:"حزام امان" },
  { date:"2026-05-17", driver:"سليمان مرغنى عبدالله سليمان",    amount:200, type:"حزام امان" },
  { date:"2026-04-07", driver:"محمود عطيه ابراهيم محمد الشاذلى",amount:200, type:"حزام امان" },
  { date:"2026-05-22", driver:"محمد صبرى نبوى ابراهيم",         amount:200, type:"حزام امان" },
  { date:"2026-05-24", driver:"محمد صبرى نبوى ابراهيم",         amount:150, type:"حزام امان" },
  { date:"2026-05-25", driver:"محمد صبرى نبوى ابراهيم",         amount:150, type:"حزام امان" },
  { date:"2026-05-27", driver:"محمد صبرى نبوى ابراهيم",         amount:200, type:"حزام امان" },
  { date:"2026-05-26", driver:"محمد صبرى نبوى ابراهيم",         amount:200, type:"حزام امان" },
  { date:"2026-05-19", driver:"محمد صبرى نبوى ابراهيم",         amount:150, type:"حزام امان" },
  { date:"2026-05-14", driver:"محمد صبرى نبوى ابراهيم",         amount:150, type:"حزام امان" },
  { date:"2026-05-11", driver:"محمد صبرى نبوى ابراهيم",         amount:100, type:"حزام امان" },
  { date:"2026-05-04", driver:"محمد صبرى نبوى ابراهيم",         amount:150, type:"حزام امان" },
  { date:"2026-05-03", driver:"محمد صبرى نبوى ابراهيم",         amount:150, type:"حزام امان" },
  { date:"2026-05-02", driver:"محمد صبرى نبوى ابراهيم",         amount:150, type:"حزام امان" },
  { date:"2026-04-22", driver:"محمد صبرى نبوى ابراهيم",         amount:200, type:"حزام امان" },
  { date:"2026-04-21", driver:"محمد صبرى نبوى ابراهيم",         amount:150, type:"حزام امان" },
  { date:"2026-04-20", driver:"محمد صبرى نبوى ابراهيم",         amount:200, type:"حزام امان" },
  { date:"2026-04-24", driver:"محمد صبرى نبوى ابراهيم",         amount:200, type:"حزام امان" },
  { date:"2026-04-26", driver:"محمد صبرى نبوى ابراهيم",         amount:200, type:"حزام امان" },
  { date:"2026-04-28", driver:"محمد صبرى نبوى ابراهيم",         amount:200, type:"حزام امان" },
  { date:"2026-04-07", driver:"محمد صبرى نبوى ابراهيم",         amount:200, type:"حزام امان" },
  { date:"2026-05-08", driver:"سليمان مرغنى عبدالله سليمان",    amount:100, type:"حزام امان" }
];

const PRELOADED_LICENSES = [
  { carNumber:"1215",  company:"قادر فرونس",      carType:"دبابة",       chassis:"7109772",    motor:"252565",    driver:"مينا الفتح",                   expiry:"2026-05-12" },
  { carNumber:"1216",  company:"مصر للنقل",        carType:"نقل كابينة",  chassis:"10864",      motor:"3338297",   driver:"مسيح النصر",                   expiry:"2026-10-14" },
  { carNumber:"1235",  company:"مصر للنقل",        carType:"دبابة",       chassis:"70025450",   motor:"6024024",   driver:"فتحى صابر",                    expiry:"2026-06-25" },
  { carNumber:"1273",  company:"ذورجن امبكت",      carType:"دبة كابينة",  chassis:"3649",       motor:"839",       driver:"احمد شاكر السيد",              expiry:"2026-08-14" },
  { carNumber:"1278",  company:"مصر للفرس",        carType:"جامبو",       chassis:"7104670",    motor:"741256",    driver:"ابراهيم فتحى محمد",            expiry:"2026-11-09" },
  { carNumber:"1358",  company:"مصر للنوربات",     carType:"نترنو",       chassis:"432724",     motor:"273638",    driver:"احمد شاكر السيد",              expiry:"2026-07-22" },
  { carNumber:"1371",  company:"مصر للنوربات",     carType:"نترنو",       chassis:"370025054",  motor:"6021884",   driver:"فخرى صابر",                    expiry:"2026-07-18" },
  { carNumber:"1496",  company:"مصر للنوربات",     carType:"دبة",         chassis:"3815",       motor:"52839",     driver:"عمر محمد حسن كمال عمر",        expiry:"2026-09-16" },
  { carNumber:"1519",  company:"احدى الاسلام",     carType:"نترنو",       chassis:"############",motor:"969632",   driver:"محمود مهدى احمد",              expiry:"2026-07-31" },
  { carNumber:"1566",  company:"قادر فرونس",       carType:"جامبو",       chassis:"7100832",    motor:"6073939",   driver:"احمد محمود فوزى احمد",         expiry:"2026-11-17" },
  { carNumber:"1579",  company:"مصر للنوربات",     carType:"دبة",         chassis:"4170934",    motor:"60022458",  driver:"محمد عبدالله محمد عبدالوهاب", expiry:"2026-12-06" },
  { carNumber:"1633",  company:"مصر للنوربات",     carType:"نترنو",       chassis:"7100729",    motor:"4092635",   driver:"",                             expiry:"2026-12-29" },
  { carNumber:"1928",  company:"مصر للنوربات",     carType:"نترنو",       chassis:"4077126",    motor:"747142",    driver:"محمود عبداللطيف احمد",         expiry:"2026-10-08" },
  { carNumber:"2198",  company:"قادر فرونس",       carType:"جامبو",       chassis:"160017923",  motor:"632196",    driver:"",                             expiry:"2026-06-22" },
  { carNumber:"2467",  company:"مصر للنوربات",     carType:"ملكى",        chassis:"4077126",    motor:"60022458",  driver:"عمرو لينا",                    expiry:"2026-08-11" },
  { carNumber:"2483",  company:"برادو جيب",        carType:"نترنو",       chassis:"160017923",  motor:"632196",    driver:"احمد حسن هاشم عبدالله",       expiry:"2026-06-22" },
  { carNumber:"2538",  company:"مصر للنوربات",     carType:"اوتوبس",      chassis:"233186",     motor:"290239",    driver:"عزت ابراهيم عبدالعزيز",       expiry:"2026-08-13" },
  { carNumber:"2547",  company:"مصر للنوربات",     carType:"اوتوبس",      chassis:"233210",     motor:"290273",    driver:"محيي الدين علي عبد الحميد",    expiry:"2026-05-29" },
  { carNumber:"2579",  company:"ذورجن امبكت",      carType:"اوتوبس",      chassis:"233169",     motor:"287663",    driver:"اشرف خليل برهامى",             expiry:"2026-08-08" },
  { carNumber:"2591",  company:"مصر للنوربات",     carType:"دبة كابينة",  chassis:"946404",     motor:"5246",      driver:"احمد عبدالعليم محمد طه",       expiry:"2027-01-02" },
  { carNumber:"2781",  company:"ذورجن امبكت",      carType:"جامبو",       chassis:"57102210",   motor:"88201",     driver:"دياب اسماعيل الجبالي",         expiry:"2027-01-24" },
  { carNumber:"3481",  company:"مصر للنوربات",     carType:"اوتوبس",      chassis:"233281",     motor:"290340",    driver:"عصام سعيد عبدالصادق",          expiry:"2026-09-27" },
  { carNumber:"4616",  company:"مصر للنوربات",     carType:"نقل",         chassis:"150091",     motor:"248302",    driver:"محمد حسين عبدالفتاح",          expiry:"2026-11-01" },
  { carNumber:"5468",  company:"مصر للنوربات",     carType:"دبة",         chassis:"4084456",    motor:"60033898",  driver:"محمد السيد يحيى حسن",          expiry:"2026-11-08" },
  { carNumber:"5723",  company:"مصر للنوربات",     carType:"دبة",         chassis:"4084378",    motor:"60033820",  driver:"احمد محمود عبدالخالق",         expiry:"2026-10-08" },
  { carNumber:"5724",  company:"مصر للنوربات",     carType:"دبة",         chassis:"4084455",    motor:"60033897",  driver:"محمد احمد حسانين السيد",       expiry:"2026-10-08" },
  { carNumber:"5734",  company:"مصر للنوربات",     carType:"دبابة",       chassis:"70040547",   motor:"6033020",   driver:"يحيى البدرى",                  expiry:"2026-10-05" },
  { carNumber:"6538",  company:"ذورجن امبكت",      carType:"جامبو",       chassis:"7100997",    motor:"420434",    driver:"دياب اسماعيل الجبالي",         expiry:"2026-09-24" },
  { carNumber:"6814",  company:"مصر للنوربات",     carType:"دبة",         chassis:"4062048",    motor:"3007085",   driver:"محمد ابراهيم حسن موسى",        expiry:"2026-08-24" },
  { carNumber:"7385",  company:"ذورجن امبكت",      carType:"جامبو",       chassis:"7100786",    motor:"420277",    driver:"عادل رشوان",                   expiry:"2026-09-17" },
  { carNumber:"8245",  company:"مصر للنوربات",     carType:"دبة",         chassis:"4064028",    motor:"3009065",   driver:"عادل عبدالنبى الحلبى",         expiry:"2026-08-17" },
  { carNumber:"8265",  company:"مصر للنوربات",     carType:"دبة",         chassis:"4064048",    motor:"3009085",   driver:"السيد ابراهيم عسران حفنى",     expiry:"2026-08-17" },
  { carNumber:"8562",  company:"مصر للنوربات",     carType:"نترنو",       chassis:"4086178",    motor:"60036520",  driver:"حازم محمد محمد ابراهيم",       expiry:"2026-12-09" },
  { carNumber:"9124",  company:"مصر للنوربات",     carType:"نترنو",       chassis:"4084363",    motor:"60033805",  driver:"محمود عطيه ابراهيم",           expiry:"2026-08-26" },
  { carNumber:"9386",  company:"مصر للنوربات",     carType:"دبة",         chassis:"4090002",    motor:"60040344",  driver:"احمد عبدالله",                 expiry:"2026-12-19" },
  { carNumber:"1278",  company:"مصر للنوربات",     carType:"جامبو",       chassis:"7104670",    motor:"741256",    driver:"علاء محمد محمد النحاس",        expiry:"2026-11-09" }
];
