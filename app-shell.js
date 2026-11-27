/* Shared authenticated application shell for internal FormFill Mitra pages. */
(async function () {
  const page = location.pathname.split("/").pop() || "index.html";
  if (document.body.dataset.ffmShell === "ready") return;

  document.documentElement.style.visibility = "hidden";

  const clearLocalSession = () => {
    ["isLoggedIn", "loginType", "ffm_admin_user"].forEach(key => localStorage.removeItem(key));
  };
  const savedRole = (localStorage.getItem("loginType") || "personal").toLowerCase();
  const loginPage = savedRole === "professional" ? "professional-login.html" : "personal-login.html";
  const redirect = (url) => location.replace(url);

  try {
    const [{ auth }, { onAuthStateChanged, signOut }, { bootstrapProfile }] = await Promise.all([
      import("./firebase-init.js"),
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js"),
      import("./api-client.js")
    ]);
    const user = await new Promise(resolve => {
      const unsubscribe = onAuthStateChanged(auth, value => {
        unsubscribe();
        resolve(value);
      }, () => resolve(null));
    });

    if (!user || user.emailVerified !== true) {
      if (user) await signOut(auth).catch(() => {});
      clearLocalSession();
      redirect(loginPage);
      return;
    }

    let profile;
    try {
      const bootstrap = await bootstrapProfile(savedRole, user.displayName || "");
      profile = bootstrap.profile;
    } catch (error) {
      console.error("Workspace profile verification failed:", error);
      clearLocalSession();
      redirect(loginPage);
      return;
    }
    const role = String(profile && profile.role || "").toLowerCase();
    if (!["admin", "professional", "personal", "staff"].includes(role) || profile.status === "disabled") {
      await signOut(auth).catch(() => {});
      clearLocalSession();
      redirect(loginPage);
      return;
    }
    const isAdmin = role === "admin";
    const adminOnly = new Set(["ai-assistant.html", "staff-management.html", "task-management.html"]);
    const personalOnly = new Set(["document-vault.html", "profile.html"]);
    if (page === "form-catalog.html" && role === "admin") { redirect("form-management.html"); return; }
    if (page === "subscription.html" && role === "admin") { redirect("subscription-management.html"); return; }

    if (adminOnly.has(page) && role !== "admin") {
      redirect(role === "professional" ? "professional-dashboard.html" : "personal-dashboard.html");
      return;
    }
    if (personalOnly.has(page) && role !== "personal") {
      redirect(role === "professional" ? "professional-dashboard.html" : "admin-panel.html");
      return;
    }

    localStorage.setItem("isLoggedIn", "true");
    localStorage.setItem("loginType", role);
    if (isAdmin) localStorage.setItem("ffm_admin_user", user.email || "faijraja28@gmail.com");
    else localStorage.removeItem("ffm_admin_user");

    const dashboard = role === "admin" ? "admin-panel.html" : role === "professional" ? "professional-dashboard.html" : "personal-dashboard.html";
    const links = role === "admin"
      ? [["Dashboard","admin-panel.html"],["Form Management","form-management.html"],["Subscription & Payment","subscription-management.html"],["Staff Management","staff-management.html"],["Task Management","task-management.html"],["Activity Monitoring","activity-monitoring.html"],["AI Assistant","ai-assistant.html"]]
      : role === "professional"
        ? [["Dashboard","professional-dashboard.html"],["Applications","my-applications.html"],["Activity Monitoring","activity-monitoring.html"],["Browse Forms","form-catalog.html"],["Subscription","subscription.html"]]
        : [["Dashboard","personal-dashboard.html"],["My Applications","my-applications.html"],["Document Vault","document-vault.html"],["My Profile","profile.html"],["Browse Forms","form-catalog.html"],["Subscription","subscription.html"]];

    const header = document.querySelector("header") || (() => {
      const node = document.createElement("header");
      document.body.prepend(node);
      return node;
    })();
    const pageTitle = document.createElement("div");
    pageTitle.className = "ffm-shell-page-title";
    while (header.firstChild) pageTitle.appendChild(header.firstChild);
    pageTitle.querySelectorAll(".logo,.brand,button,a,.logout-btn,.profile-name,.user-name").forEach(node => node.remove());
    pageTitle.querySelectorAll("strong").forEach(node => { if (/formfill\s*mitra/i.test(node.textContent || "")) node.remove(); });
    pageTitle.querySelectorAll("h1,h2").forEach(node => { if (/formfill\s*mitra/i.test(node.textContent || "")) node.remove(); });
    if (!pageTitle.textContent.trim()) pageTitle.textContent = document.title.replace(/formfill\s*mitra/ig, "").replace(/[|–—-]/g, " ").trim() || "Workspace";

    const toggle = document.createElement("button");
    toggle.className = "ffm-shell-toggle";
    toggle.type = "button";
    toggle.textContent = "☰";
    toggle.setAttribute("aria-label", "Open navigation menu");
    toggle.setAttribute("aria-expanded", "false");

    const brand = document.createElement("a");
    brand.className = "ffm-shell-brand";
    brand.href = dashboard;
    brand.innerHTML = 'FormFill <span>Mitra</span>';

    header.classList.add("ffm-shell-header");
    header.replaceChildren(toggle, pageTitle, brand);

    const backdrop = document.createElement("div");
    backdrop.className = "ffm-shell-backdrop";
    const drawer = document.createElement("aside");
    drawer.className = "ffm-shell-drawer";
    drawer.setAttribute("aria-label", "Main navigation");

    const heading = document.createElement("div");
    heading.className = "ffm-shell-drawer-head";
    heading.innerHTML = '<strong>Navigation</strong><button type="button" aria-label="Close menu">×</button>';
    drawer.appendChild(heading);

    const nav = document.createElement("nav");
    nav.className = "ffm-shell-nav";
    links.forEach(([label, url]) => {
      const link = document.createElement("a");
      link.href = url;
      link.textContent = label;
      if (url === page) link.classList.add("active");
      nav.appendChild(link);
    });
    drawer.appendChild(nav);

    const bottom = document.createElement("div");
    bottom.className = "ffm-shell-bottom";
    const logout = document.createElement("button");
    logout.type = "button";
    logout.textContent = "↪  Log Out";
    logout.addEventListener("click", async () => {
      if (!confirm("Are you sure you want to log out?")) return;
      logout.disabled = true;
      try {
        await signOut(auth);
        clearLocalSession();
        redirect(loginPage);
      } catch (error) {
        console.error("Sign-out failed:", error);
        logout.disabled = false;
        alert("We could not sign you out. Please try again.");
      }
    });
    bottom.appendChild(logout);
    drawer.appendChild(bottom);
    document.body.append(backdrop, drawer);

    const close = () => {
      drawer.classList.remove("open");
      backdrop.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
    };
    const open = () => {
      drawer.classList.add("open");
      backdrop.classList.add("open");
      toggle.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
    };
    toggle.addEventListener("click", open);
    backdrop.addEventListener("click", close);
    heading.querySelector("button").addEventListener("click", close);
    drawer.querySelectorAll("a").forEach(link => link.addEventListener("click", close));
    document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });

    const style = document.createElement("style");
    style.textContent = `
      .ffm-shell-header{display:grid!important;grid-template-columns:48px minmax(0,1fr) auto!important;align-items:center!important;gap:16px!important;min-height:72px!important;padding:12px clamp(16px,4vw,42px)!important;background:#fff!important;border-bottom:1px solid #dce7f7!important;box-shadow:0 3px 18px rgba(25,72,130,.06)!important}
      .ffm-shell-toggle{grid-column:1;grid-row:1;width:44px;height:44px;border:1px solid #dce7f7;border-radius:12px;background:#edf5ff;color:#1769e8;font-size:23px;cursor:pointer}
      .ffm-shell-page-title{grid-column:2;grid-row:1;min-width:0}
      .ffm-shell-page-title h1,.ffm-shell-page-title h2{margin:0}.ffm-shell-page-title p{margin:0;color:#64748b;font-size:13px}
      .ffm-shell-brand{grid-column:3;grid-row:1;white-space:nowrap;text-decoration:none!important;font-size:22px;font-weight:850;letter-spacing:-.6px;color:#17345f!important}
      .ffm-shell-brand span{color:#1769e8}
      .ffm-shell-backdrop{position:fixed;z-index:90;inset:0;background:rgba(15,35,65,.34);opacity:0;visibility:hidden;transition:.2s}
      .ffm-shell-backdrop.open{opacity:1;visibility:visible}
      .ffm-shell-drawer{position:fixed;z-index:91;inset:0 auto 0 0;width:min(310px,86vw);padding:20px;background:#fff;box-shadow:12px 0 35px rgba(20,55,100,.16);transform:translateX(-105%);transition:transform .22s ease;display:flex;flex-direction:column}
      .ffm-shell-drawer.open{transform:translateX(0)}
      .ffm-shell-drawer-head{display:flex;align-items:center;justify-content:space-between;padding-bottom:18px;border-bottom:1px solid #e7eef8}
      .ffm-shell-drawer-head button{width:36px;height:36px;border:0;border-radius:9px;background:#f1f5fb;color:#526783;font-size:24px;cursor:pointer}
      .ffm-shell-nav{display:grid;gap:6px;padding-top:18px}
      .ffm-shell-nav a{padding:12px;border-radius:10px;text-decoration:none;color:#29415f;font-weight:700}
      .ffm-shell-nav a:hover,.ffm-shell-nav a.active{background:#edf5ff;color:#1769e8}
      .ffm-shell-bottom{margin-top:auto;border-top:1px solid #e7eef8;padding-top:14px}
      .ffm-shell-bottom button{width:100%;padding:12px;border:0;border-radius:10px;background:#fff1f1;color:#b42318;font-weight:750;text-align:left;cursor:pointer}
      @media(max-width:640px){.ffm-shell-header{grid-template-columns:44px minmax(0,1fr) auto!important;min-height:66px!important;padding:10px 14px!important}.ffm-shell-brand{font-size:18px}.ffm-shell-page-title h1{font-size:18px}}
    `;
    document.head.appendChild(style);
    document.body.dataset.ffmShell = "ready";
    document.documentElement.style.visibility = "";
  } catch (error) {
    console.error("Application access check failed:", error);
    document.documentElement.style.visibility = "";
    alert("We could not verify your sign-in session. Please sign in again.");
    clearLocalSession();
    redirect(loginPage);
  }
})();