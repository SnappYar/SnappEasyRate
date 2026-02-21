(() => {
    /**
     * Keys used in chrome.storage
     */
    const STORAGE_KEYS = {
        apiUrl: 'sms_api_url',
        authToken: 'sms_auth_token',
        logs: 'sms_logs',
        sfToken: 'sf_token',
        sfTokenExpiry: 'sf_token_expiry',
        sfVendors: 'sf_vendors',
        sfTokenByDomain: 'sf_token_by_domain',
        sfTokenExpiryByDomain: 'sf_token_expiry_by_domain',
        sfVendorsByDomain: 'sf_vendors_by_domain',
        smsTemplate: 'sms_template',
        smsTemplatesByDomain: 'sms_templates_by_domain',
        linkBaseByDomain: 'link_base_by_domain'
    };

    const DEFAULT_DOMAIN_KEY = '';

    /** All known storage keys used by this extension (for fallback get) */
    var ALL_STORAGE_KEYS_LIST = [
        'sms_logs', 'sms_api_url', 'sms_auth_token', 'sms_template',
        'sms_templates_by_domain', 'link_base_by_domain',
        'sf_token', 'sf_token_expiry', 'sf_vendors',
        'sf_token_by_domain', 'sf_token_expiry_by_domain', 'sf_vendors_by_domain'
    ];

    /**
     * Safe storage get. Never pass undefined to get(keys) — use explicit key list or single-key fallback to avoid "Value did not match any choice".
     */
    function storageGet(callback) {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync || typeof chrome.storage.sync.get !== 'function') {
            callback({});
            return;
        }
        function done(data) {
            try {
                callback(data && typeof data === 'object' ? data : {});
            } catch (e) {
                callback({});
            }
        }
        var storage = chrome.storage.sync;
        // 1) Prefer callback API with explicit keys (valid string[]), never no-args
        try {
            storage.get(ALL_STORAGE_KEYS_LIST, function (data) {
                done(data || {});
            });
        } catch (e) {
            console.warn('storage.get(keys) failed, falling back to single-key reads:', e);
            // 2) Fallback: read one key at a time (keys param is string — always valid)
            var result = {};
            var keys = ALL_STORAGE_KEYS_LIST.slice();
            var idx = 0;
            function next() {
                if (idx >= keys.length) {
                    done(result);
                    return;
                }
                var k = keys[idx++];
                try {
                    storage.get(k, function (obj) {
                        if (obj && obj[k] !== undefined) result[k] = obj[k];
                        next();
                    });
                } catch (err) {
                    next();
                }
            }
            next();
        }
    }

    /**
     * Append a message to the log textarea and persist a rolling log
     */
    function appendLog(message) {
        const timestamp = new Date().toLocaleString();
        const line = `[${timestamp}] ${message}`;
        const output = document.getElementById('logOutput');
        if (output) {
            output.value = (output.value ? output.value + '\n' : '') + line;
            output.scrollTop = output.scrollHeight;
        }
        storageGet((data) => {
            const current = Array.isArray(data && data.sms_logs) ? data.sms_logs : [];
            current.push(line);
            // keep last 200 lines
            const trimmed = current.slice(-200);
            chrome.storage.sync.set({ [STORAGE_KEYS.logs]: trimmed });
        });
    }

    function setGatedEnabled(enabled) {
        const phoneInput = document.getElementById('phoneNumber');
        const msgInput = document.getElementById('message');
        const sendBtn = document.getElementById('sendBtn');
        const hint = document.getElementById('gateHint');
        [phoneInput, msgInput, sendBtn].forEach((el) => {
            if (el) el.disabled = !enabled;
        });
        if (hint) hint.style.display = enabled ? 'none' : 'block';
    }

    function loadSettings(callback) {
        storageGet((data) => {
            data = data || {};
            const apiUrl = data.sms_api_url || '';
            const authToken = data.sms_auth_token || '';
            callback({ apiUrl, authToken });
        });
    }

    function saveSettings({ apiUrl, authToken }, onDone) {
        chrome.storage.sync.set({
            [STORAGE_KEYS.apiUrl]: apiUrl || '',
            [STORAGE_KEYS.authToken]: authToken || ''
        }, onDone);
    }

    async function sendSms({ apiUrl, authToken, phoneNumber, message }) {
        if (!apiUrl || !authToken) {
            throw new Error('API URL یا توکن تنظیم نشده است');
        }
        appendLog(`ارسال پیام به ${phoneNumber}...`);
        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': authToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ProviderId: 1,
                Number: phoneNumber,
                Message: message
            })
        });

        // Chrome fetch Response doesn't have statusCode, use status
        if (res.status >= 300) {
            const text = await safeReadBody(res);
            throw new Error(`خطا در ارسال (${res.status}): ${text}`);
        }
        const text = await safeReadBody(res);
        return text;
    }

    async function safeReadBody(res) {
        try {
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
                const j = await res.json();
                return JSON.stringify(j);
            }
            return await res.text();
        } catch (_) {
            return '';
        }
    }

    function setSnappfoodControlsEnabled(enabled) {
        const methodRadios = document.querySelectorAll('input[name="sfLoginMethod"]');
        methodRadios.forEach(r => r.disabled = !enabled);
        const pwdInputs = [
            document.getElementById('sfCellphonePwd'),
            document.getElementById('sfPassword'),
            document.getElementById('sfPasswordLoginBtn')
        ];
        pwdInputs.forEach(el => { if (el) el.disabled = !enabled; });
        const otpInputs = [
            document.getElementById('sfCellphoneOtp'),
            document.getElementById('sfSendOtpBtn'),
            document.getElementById('sfOtpCode'),
            document.getElementById('sfVerifyOtpBtn')
        ];
        otpInputs.forEach(el => { if (el) el.disabled = !enabled; });
    }

    function setSnappfoodStatusUI(domainKey, { token, expiry }) {
        const statusEl = document.getElementById('sfTokenStatus');
        const logoutBtn = document.getElementById('sfLogoutBtn');
        const sfDomainSelect = document.getElementById('sfDomainSelect');
        if (!statusEl || !logoutBtn) return;
        const now = Date.now();
        const valid = Boolean(token && expiry && now < expiry);
        const label = (domainKey === DEFAULT_DOMAIN_KEY || !domainKey) ? 'پیش‌فرض' : domainKey;
        if (valid) {
            const remainingMs = expiry - now;
            const remainingDays = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
            statusEl.textContent = `وضعیت (${label}): وارد شده — انقضا تا ${remainingDays} روز دیگر`;
            statusEl.className = 'status status-success';
            logoutBtn.style.display = 'inline-block';
            logoutBtn.dataset.domain = domainKey === undefined ? '' : String(domainKey);
            setSnappfoodControlsEnabled(false);
            if (typeof window !== 'undefined' && window.__sfOtpTimerStop) {
                try { window.__sfOtpTimerStop(); } catch (_) { }
            }
        } else {
            statusEl.textContent = `وضعیت (${label}): خارج شده`;
            statusEl.className = 'status status-muted';
            logoutBtn.style.display = 'none';
            setSnappfoodControlsEnabled(true);
        }
    }

    function saveSnappfoodToken(token, expiryMs, domainKey) {
        const expiry = typeof expiryMs === 'number' ? expiryMs : Date.now() + 7 * 24 * 60 * 60 * 1000;
        const key = domainKey === undefined || domainKey === null ? DEFAULT_DOMAIN_KEY : String(domainKey);
        storageGet((data) => {
            data = data || {};
            const byToken = (data.sf_token_by_domain && typeof data.sf_token_by_domain === 'object') ? { ...data.sf_token_by_domain } : {};
            const byExpiry = (data.sf_token_expiry_by_domain && typeof data.sf_token_expiry_by_domain === 'object') ? { ...data.sf_token_expiry_by_domain } : {};
            byToken[key] = token || '';
            byExpiry[key] = expiry;
            const payload = {
                [STORAGE_KEYS.sfTokenByDomain]: byToken,
                [STORAGE_KEYS.sfTokenExpiryByDomain]: byExpiry
            };
            if (key === DEFAULT_DOMAIN_KEY) {
                payload[STORAGE_KEYS.sfToken] = token || '';
                payload[STORAGE_KEYS.sfTokenExpiry] = expiry;
            }
            chrome.storage.sync.set(payload, () => {
                if (typeof window.__refreshSFStatusForDomain === 'function') window.__refreshSFStatusForDomain(key);
                if (typeof window.__refreshSFAccountsList === 'function') window.__refreshSFAccountsList();
                appendLog(key ? `توکن اسنپ‌فود برای ${key} ذخیره شد` : 'توکن اسنپ‌فود ذخیره شد');
            });
        });
    }

    function loadSnappfoodToken(domainKey, cb) {
        const key = domainKey === undefined || domainKey === null ? DEFAULT_DOMAIN_KEY : String(domainKey);
        storageGet((data) => {
            data = data || {};
            const byToken = (data.sf_token_by_domain && typeof data.sf_token_by_domain === 'object') ? data.sf_token_by_domain : {};
            const byExpiry = (data.sf_token_expiry_by_domain && typeof data.sf_token_expiry_by_domain === 'object') ? data.sf_token_expiry_by_domain : {};
            const token = (key && byToken[key] !== undefined) ? byToken[key] : (byToken[DEFAULT_DOMAIN_KEY] !== undefined ? byToken[DEFAULT_DOMAIN_KEY] : data.sf_token || '');
            const expiry = (key && byExpiry[key] !== undefined) ? byExpiry[key] : (byExpiry[DEFAULT_DOMAIN_KEY] !== undefined ? byExpiry[DEFAULT_DOMAIN_KEY] : data.sf_token_expiry || 0);
            cb({ token, expiry });
        });
    }

    function loadSnappfoodVendors(domainKey, cb) {
        const key = domainKey === undefined || domainKey === null ? DEFAULT_DOMAIN_KEY : String(domainKey);
        storageGet((data) => {
            data = data || {};
            const byDomain = (data.sf_vendors_by_domain && typeof data.sf_vendors_by_domain === 'object') ? data.sf_vendors_by_domain : {};
            const vendors = (key && Array.isArray(byDomain[key])) ? byDomain[key] : (Array.isArray(byDomain[DEFAULT_DOMAIN_KEY]) ? byDomain[DEFAULT_DOMAIN_KEY] : (Array.isArray(data.sf_vendors) ? data.sf_vendors : []));
            cb(vendors);
        });
    }

    function saveSnappfoodVendors(vendors, domainKey) {
        const key = domainKey === undefined || domainKey === null ? DEFAULT_DOMAIN_KEY : String(domainKey);
        storageGet((data) => {
            data = data || {};
            const byDomain = (data.sf_vendors_by_domain && typeof data.sf_vendors_by_domain === 'object') ? { ...data.sf_vendors_by_domain } : {};
            byDomain[key] = Array.isArray(vendors) ? vendors : [];
            const payload = { [STORAGE_KEYS.sfVendorsByDomain]: byDomain };
            if (key === DEFAULT_DOMAIN_KEY) payload[STORAGE_KEYS.sfVendors] = byDomain[key];
            chrome.storage.sync.set(payload, () => {
                appendLog(`لیست وندورها برای ${key || 'پیش‌فرض'} ذخیره شد (${byDomain[key].length})`);
            });
        });
    }

    function normalizeSnappfoodToken(raw) {
        if (!raw) return '';
        try {
            const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const candidate = obj?.data?.vendor?.accessToken
                || obj?.vendor?.accessToken
                || obj?.data?.order?.accessToken
                || obj?.order?.accessToken
                || obj?.accessToken
                || obj?.data?.access_token
                || obj?.access_token;
            // appendLog(`توکن اسنپفود: ${candidate}`);
            return typeof candidate === 'string' ? candidate : '';
        } catch (_) {
            return '';
        }
    }

    async function fetchSnappfoodVendors({ token }) {
        const bearer = `Bearer ${token}`;
        if (!bearer) throw new Error('توکن اسنپ\fفود موجود نیست یا معتبر نیست');
        const res = await fetch('https://vendor.snappfood.ir/vms/v2/user/vendors', {
            method: 'GET',
            headers: {
                'Authorization': bearer,
                'Accept': 'application/json'
            }
        });
        const text = await safeReadBody(res);
        if (res.status >= 300) {
            throw new Error(`دریافت وندورها ناموفق (${res.status}): ${text}`);
        }
        let json;
        try { json = JSON.parse(text || '{}'); } catch (_) { json = null; }
        // Prefer JSON:API shape with included vendorUser entries
        let items = [];
        if (Array.isArray(json?.included)) {
            items = json.included.filter(e => e && e.type === 'vendorUser');
        }
        // Fallbacks: plain array or data array
        if (!items.length) {
            if (Array.isArray(json)) items = json;
            else if (Array.isArray(json?.data)) items = json.data;
        }
        const mapped = items.map((item) => {
            const id = item?.id || item?.attributes?.id;
            const title = item?.attributes?.title || item?.title || '';
            return { id: String(id || ''), title: String(title || '') };
        }).filter(v => v.id && v.title);
        return mapped;
    }

    async function sfLoginWithPassword({ cellphone, password }) {
        const body = {
            data: {
                scopes: ["vmo", "vms"],
                client_id: "snappfood_vms",
                client_secret: "snappfood_vms_secret"
            },
            grantType: "Password",
            cellphone,
            password
        };
        const res = await fetch('https://user.snappfood.ir/v1/auth/vendor/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const text = await safeReadBody(res);
        if (res.status >= 300) {
            throw new Error(`خطا ورود (${res.status}): ${text}`);
        }
        try {
            const json = JSON.parse(text || '{}');
            const vendor = json?.data?.vendor || json?.vendor;
            const token = vendor?.accessToken || json?.data?.access_token || json?.access_token || text;
            const expiresSec = vendor?.accessTokenExpiresAt;
            const expiryMs = typeof expiresSec === 'number' ? expiresSec * 1000 : undefined;
            return { token, expiryMs };
        } catch (_) {
            return { token: text, expiryMs: undefined };
        }
    }

    async function sfSendOtp({ mobile_number }) {
        const res = await fetch('https://user.snappfood.ir/v1/auth/otp/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile_number })
        });
        const text = await safeReadBody(res);
        if (res.status >= 300) {
            throw new Error(`ارسال کد ناموفق (${res.status}): ${text}`);
        }
        return text;
    }

    async function sfVerifyOtp({ cellphone, otpCode }) {
        const body = {
            data: {
                scopes: ["vmo", "vms"],
                client_id: "snappfood_vms",
                client_secret: "snappfood_vms_secret"
            },
            grantType: "Otp",
            cellphone,
            otpCode,
        };
        const res = await fetch('https://user.snappfood.ir/v1/auth/vendor/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(body)
        });
        const text = await safeReadBody(res);
        if (res.status >= 300) {
            throw new Error(`تایید کد ناموفق (${res.status}): ${text}`);
        }
        try {
            const json = JSON.parse(text || '{}');
            const vendor = json?.data?.vendor || json?.vendor;
            const token = vendor?.accessToken || json?.data?.access_token || json?.access_token || text;
            const expiresSec = vendor?.accessTokenExpiresAt;
            const expiryMs = typeof expiresSec === 'number' ? expiresSec * 1000 : undefined;
            return { token, expiryMs };
        } catch (_) {
            return { token: text, expiryMs: undefined };
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const apiUrlInput = document.getElementById('apiUrl');
        const authTokenInput = document.getElementById('authToken');
        const saveSettingsBtn = document.getElementById('saveSettingsBtn');
        const saveStatus = document.getElementById('saveStatus');
        const phoneInput = document.getElementById('phoneNumber');
        const msgInput = document.getElementById('message');
        const sendBtn = document.getElementById('sendBtn');
        const clearLogBtn = document.getElementById('clearLogBtn');
        const smsTemplateInput = document.getElementById('smsTemplate');
        const saveTemplateBtn = document.getElementById('saveTemplateBtn');

        // Load logs
        storageGet((data) => {
            data = data || {};
            const lines = Array.isArray(data.sms_logs) ? data.sms_logs : [];
            const output = document.getElementById('logOutput');
            if (output) {
                output.value = lines.length ? lines.join('\n') : '';
                output.scrollTop = output.scrollHeight;
            }
        });

        // Load settings and gate test section
        loadSettings(({ apiUrl, authToken }) => {
            if (apiUrlInput) apiUrlInput.value = apiUrl;
            if (authTokenInput) authTokenInput.value = authToken;
            const enabled = Boolean(apiUrl && authToken);
            setGatedEnabled(enabled);
        });

        // Load SMS templates by domain and link bases (per-address)
        function loadTemplatesByDomain(cb) {
            storageGet((data) => {
                data = data || {};
                const legacy = typeof data.sms_template === 'string' ? data.sms_template : '';
                const byDomain = data.sms_templates_by_domain;
                const obj = typeof byDomain === 'object' && byDomain !== null ? { ...byDomain } : {};
                if (legacy && obj[DEFAULT_DOMAIN_KEY] === undefined) obj[DEFAULT_DOMAIN_KEY] = legacy;
                const linkBases = data.link_base_by_domain;
                const linkObj = typeof linkBases === 'object' && linkBases !== null ? { ...linkBases } : {};
                cb({ templates: obj, linkBases: linkObj });
            });
        }

        function refreshDomainSelect(templates) {
            const domainSelect = document.getElementById('domainSelect');
            if (!domainSelect) return;
            const current = domainSelect.value;
            domainSelect.innerHTML = '';
            const opt0 = document.createElement('option');
            opt0.value = DEFAULT_DOMAIN_KEY;
            opt0.textContent = 'پیش‌فرض (همهٔ آدرس‌ها)';
            domainSelect.appendChild(opt0);
            const domains = Object.keys(templates).filter(k => k !== DEFAULT_DOMAIN_KEY).sort();
            domains.forEach((d) => {
                const opt = document.createElement('option');
                opt.value = d;
                opt.textContent = d || '(پیش‌فرض)';
                domainSelect.appendChild(opt);
            });
            if (domains.includes(current)) domainSelect.value = current;
            else domainSelect.value = DEFAULT_DOMAIN_KEY;
        }

        function showTemplateForDomain(templates, linkBases, domainKey) {
            if (smsTemplateInput) smsTemplateInput.value = templates[domainKey] || '';
            const linkInput = document.getElementById('linkBaseInput');
            if (linkInput) linkInput.value = linkBases[domainKey] || '';
        }

        function refreshSavedTemplatesList(templates, linkBases) {
            const listEl = document.getElementById('savedTemplatesList');
            if (!listEl) return;
            listEl.innerHTML = '';
            const domainSelect = document.getElementById('domainSelect');
            const keys = Object.keys(templates);
            if (keys.length === 0) {
                listEl.innerHTML = '<li class="muted" style="list-style:none; padding:8px 0;">هنوز قالب ذخیره‌ای ندارید. یک آدرس انتخاب یا اضافه کنید، قالب را پر و ذخیره کنید.</li>';
                return;
            }
            const hasDefault = keys.includes(DEFAULT_DOMAIN_KEY);
            const others = keys.filter(k => k !== DEFAULT_DOMAIN_KEY).sort();
            const order = hasDefault ? [DEFAULT_DOMAIN_KEY, ...others] : others;
            order.forEach((domainKey) => {
                const li = document.createElement('li');
                const label = domainKey === DEFAULT_DOMAIN_KEY ? 'پیش‌فرض (همهٔ آدرس‌ها)' : domainKey;
                li.innerHTML = '';
                const nameSpan = document.createElement('span');
                nameSpan.className = 'domain-name' + (domainKey === DEFAULT_DOMAIN_KEY ? ' empty' : '');
                nameSpan.textContent = label;
                li.appendChild(nameSpan);
                const btnEdit = document.createElement('button');
                btnEdit.type = 'button';
                btnEdit.className = 'btn-edit';
                btnEdit.textContent = 'ویرایش';
                btnEdit.addEventListener('click', () => {
                    if (domainSelect) domainSelect.value = domainKey;
                    loadTemplatesByDomain(({ templates: t, linkBases: lb }) => {
                        showTemplateForDomain(t, lb, domainKey);
                    });
                });
                li.appendChild(btnEdit);
                const btnDelete = document.createElement('button');
                btnDelete.type = 'button';
                btnDelete.className = 'btn-delete';
                btnDelete.textContent = 'حذف';
                btnDelete.addEventListener('click', () => {
                    if (domainKey === DEFAULT_DOMAIN_KEY && !confirm('حذف قالب پیش‌فرض؟')) return;
                    if (domainKey !== DEFAULT_DOMAIN_KEY && !confirm(`حذف قالب برای ${domainKey}؟`)) return;
                    loadTemplatesByDomain(({ templates: t, linkBases: lb }) => {
                        delete t[domainKey];
                        delete lb[domainKey];
                        chrome.storage.sync.set({
                            [STORAGE_KEYS.smsTemplatesByDomain]: t,
                            [STORAGE_KEYS.linkBaseByDomain]: lb
                        }, () => {
                            refreshDomainSelect(t);
                            refreshSavedTemplatesList(t, lb);
                            if (domainSelect && domainSelect.value === domainKey) {
                                domainSelect.value = DEFAULT_DOMAIN_KEY;
                                showTemplateForDomain(t, lb, DEFAULT_DOMAIN_KEY);
                            }
                            appendLog(domainKey ? `قالب ${domainKey} حذف شد` : 'قالب پیش‌فرض حذف شد');
                        });
                    });
                });
                li.appendChild(btnDelete);
                listEl.appendChild(li);
            });
        }

        function refreshSFDomainSelect(templates) {
            const sel = document.getElementById('sfDomainSelect');
            if (!sel) return;
            const cur = sel.value;
            sel.innerHTML = '';
            const opt0 = document.createElement('option');
            opt0.value = DEFAULT_DOMAIN_KEY;
            opt0.textContent = 'پیش‌فرض (همهٔ آدرس‌ها)';
            sel.appendChild(opt0);
            const domains = Object.keys(templates).filter(k => k !== DEFAULT_DOMAIN_KEY).sort();
            domains.forEach((d) => {
                const opt = document.createElement('option');
                opt.value = d;
                opt.textContent = d;
                sel.appendChild(opt);
            });
            if (domains.includes(cur)) sel.value = cur;
            else sel.value = DEFAULT_DOMAIN_KEY;
        }

        function refreshSFAccountsList() {
            const listEl = document.getElementById('sfAccountsList');
            if (!listEl) return;
            storageGet((data) => {
                data = data || {};
                const byToken = (data.sf_token_by_domain && typeof data.sf_token_by_domain === 'object') ? data.sf_token_by_domain : {};
                const byExpiry = (data.sf_token_expiry_by_domain && typeof data.sf_token_expiry_by_domain === 'object') ? data.sf_token_expiry_by_domain : {};
                const now = Date.now();
                const keys = new Set([DEFAULT_DOMAIN_KEY, ...Object.keys(byToken)]);
                const loggedIn = [];
                keys.forEach((k) => {
                    const token = (k === DEFAULT_DOMAIN_KEY && data.sf_token) ? data.sf_token : byToken[k];
                    const expiry = (k === DEFAULT_DOMAIN_KEY && data.sf_token_expiry) ? data.sf_token_expiry : byExpiry[k];
                    if (token && expiry && now < expiry) loggedIn.push({ key: k, label: k === DEFAULT_DOMAIN_KEY ? 'پیش‌فرض' : k });
                });
                listEl.innerHTML = '';
                if (loggedIn.length === 0) {
                    listEl.innerHTML = '<li class="accounts-list-empty">هنوز حسابی متصل نشده. بالا آدرس را انتخاب و ورود کنید.</li>';
                    return;
                }
                loggedIn.forEach(({ key, label }) => {
                    const li = document.createElement('li');
                    li.className = 'accounts-list-item';
                    const span = document.createElement('span');
                    span.className = 'accounts-list-label';
                    span.textContent = label;
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'btn btn-sm btn-outline-danger';
                    btn.textContent = 'خروج';
                    btn.dataset.domain = key;
                    btn.addEventListener('click', () => {
                        if (!confirm(`خروج از حساب ${label}؟`)) return;
                        storageGet((d) => {
                            d = d || {};
                            const bt = (d.sf_token_by_domain && typeof d.sf_token_by_domain === 'object') ? { ...d.sf_token_by_domain } : {};
                            const be = (d.sf_token_expiry_by_domain && typeof d.sf_token_expiry_by_domain === 'object') ? { ...d.sf_token_expiry_by_domain } : {};
                            const bv = (d.sf_vendors_by_domain && typeof d.sf_vendors_by_domain === 'object') ? { ...d.sf_vendors_by_domain } : {};
                            delete bt[key];
                            delete be[key];
                            delete bv[key];
                            const payload = {
                                [STORAGE_KEYS.sfTokenByDomain]: bt,
                                [STORAGE_KEYS.sfTokenExpiryByDomain]: be,
                                [STORAGE_KEYS.sfVendorsByDomain]: bv
                            };
                            if (key === DEFAULT_DOMAIN_KEY) {
                                payload[STORAGE_KEYS.sfToken] = '';
                                payload[STORAGE_KEYS.sfTokenExpiry] = 0;
                                payload[STORAGE_KEYS.sfVendors] = [];
                            }
                            chrome.storage.sync.set(payload, () => {
                                refreshSFAccountsList();
                                const sfSel = document.getElementById('sfDomainSelect');
                                if (sfSel && sfSel.value === key) loadSnappfoodToken(sfSel.value, (t) => setSnappfoodStatusUI(key, t));
                                appendLog(`خروج از حساب ${label} انجام شد`);
                            });
                        });
                    });
                    li.appendChild(span);
                    li.appendChild(btn);
                    listEl.appendChild(li);
                });
            });
        }

        window.__refreshSFStatusForDomain = function (domainKey) {
            const sel = document.getElementById('sfDomainSelect');
            if (sel && sel.value === (domainKey || DEFAULT_DOMAIN_KEY)) {
                loadSnappfoodToken(domainKey, (t) => setSnappfoodStatusUI(domainKey, t));
            }
        };
        window.__refreshSFAccountsList = refreshSFAccountsList;

        loadTemplatesByDomain(({ templates, linkBases }) => {
            refreshDomainSelect(templates);
            refreshSavedTemplatesList(templates, linkBases);
            refreshSFDomainSelect(templates);
            refreshSFAccountsList();
            const domainSelect = document.getElementById('domainSelect');
            const domainKey = (domainSelect && domainSelect.value) !== undefined ? (domainSelect.value || DEFAULT_DOMAIN_KEY) : DEFAULT_DOMAIN_KEY;
            showTemplateForDomain(templates, linkBases, domainKey);
            const sfDomainSelect = document.getElementById('sfDomainSelect');
            if (sfDomainSelect) {
                loadSnappfoodToken(sfDomainSelect.value || DEFAULT_DOMAIN_KEY, (t) => setSnappfoodStatusUI(sfDomainSelect.value || DEFAULT_DOMAIN_KEY, t));
            }
        });

        // Save settings
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', () => {
                const apiUrl = apiUrlInput.value.trim();
                const authToken = authTokenInput.value.trim();
                saveSettings({ apiUrl, authToken }, () => {
                    if (saveStatus) {
                        saveStatus.textContent = 'ذخیره شد!';
                        setTimeout(() => (saveStatus.textContent = ''), 1500);
                    }
                    setGatedEnabled(Boolean(apiUrl && authToken));
                    appendLog('تنظیمات ذخیره شد');
                });
            });
        }

        // Send SMS
        if (sendBtn) {
            sendBtn.addEventListener('click', () => {
                const phoneNumber = phoneInput.value.trim();
                const message = msgInput.value.trim();
                if (!phoneNumber || !message) {
                    appendLog('شماره یا متن پیام وارد نشده است');
                    return;
                }
                loadSettings(async ({ apiUrl, authToken }) => {
                    try {
                        const result = await sendSms({ apiUrl, authToken, phoneNumber, message });
                        appendLog(`ارسال موفق: ${result || 'OK'}`);
                    } catch (err) {
                        appendLog(String(err && err.message ? err.message : err));
                    }
                });
            });
        }

        const domainSelect = document.getElementById('domainSelect');
        const newDomainInput = document.getElementById('newDomainInput');
        const addDomainBtn = document.getElementById('addDomainBtn');
        const linkBaseInput = document.getElementById('linkBaseInput');

        if (domainSelect) {
            domainSelect.addEventListener('change', () => {
                loadTemplatesByDomain(({ templates, linkBases }) => {
                    showTemplateForDomain(templates, linkBases, domainSelect.value || DEFAULT_DOMAIN_KEY);
                });
            });
        }

        if (addDomainBtn && newDomainInput) {
            addDomainBtn.addEventListener('click', () => {
                const domain = (newDomainInput.value || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
                if (!domain) {
                    appendLog('لطفاً یک آدرس وارد کنید (مثلاً rasperwings.com)');
                    return;
                }
                loadTemplatesByDomain(({ templates, linkBases }) => {
                    if (templates[domain] !== undefined) {
                        domainSelect.value = domain;
                        showTemplateForDomain(templates, linkBases, domain);
                        appendLog(`قالب برای ${domain} در حال ویرایش`);
                        return;
                    }
                    templates[domain] = '';
                    chrome.storage.sync.set({ [STORAGE_KEYS.smsTemplatesByDomain]: templates }, () => {
                        refreshDomainSelect(templates);
                        refreshSavedTemplatesList(templates, linkBases);
                        refreshSFDomainSelect(templates);
                        domainSelect.value = domain;
                        showTemplateForDomain(templates, linkBases, domain);
                        newDomainInput.value = '';
                        appendLog(`آدرس ${domain} اضافه شد؛ متن و پایهٔ لینک را وارد و ذخیره کنید`);
                    });
                });
            });
        }

        // Save SMS template (and link base) for selected domain
        if (saveTemplateBtn) {
            saveTemplateBtn.addEventListener('click', () => {
                const domainKey = (domainSelect && domainSelect.value) !== undefined ? (domainSelect.value || DEFAULT_DOMAIN_KEY) : DEFAULT_DOMAIN_KEY;
                const tpl = (smsTemplateInput && smsTemplateInput.value) ? smsTemplateInput.value : '';
                const linkBase = (linkBaseInput && linkBaseInput.value) ? linkBaseInput.value.trim().replace(/\/+$/, '') : '';

                loadTemplatesByDomain(({ templates, linkBases }) => {
                    templates[domainKey] = tpl;
                    if (linkBase) linkBases[domainKey] = linkBase;
                    else delete linkBases[domainKey];
                    chrome.storage.sync.set({
                        [STORAGE_KEYS.smsTemplatesByDomain]: templates,
                        [STORAGE_KEYS.linkBaseByDomain]: linkBases
                    }, () => {
                        refreshDomainSelect(templates);
                        refreshSavedTemplatesList(templates, linkBases);
                        appendLog(domainKey ? `متن و لینک برای ${domainKey} ذخیره شد` : 'متن پیش‌فرض پیامک ذخیره شد');
                    });
                });
            });
        }

        // Clear logs
        if (clearLogBtn) {
            clearLogBtn.addEventListener('click', () => {
                chrome.storage.sync.set({ [STORAGE_KEYS.logs]: [] }, () => {
                    const output = document.getElementById('logOutput');
                    if (output) output.value = '';
                });
            });
        }

        // Snappfood UI handlers
        const methodRadios = document.querySelectorAll('input[name="sfLoginMethod"]');
        const pwdForm = document.getElementById('sfPasswordForm');
        const otpForm = document.getElementById('sfOtpForm');
        const otpStep = document.getElementById('sfOtpStep');
        const sendOtpBtn = document.getElementById('sfSendOtpBtn');
        const verifyOtpBtn = document.getElementById('sfVerifyOtpBtn');
        const pwdLoginBtn = document.getElementById('sfPasswordLoginBtn');
        const logoutBtn = document.getElementById('sfLogoutBtn');
        const otpTimerEl = document.getElementById('sfOtpTimer');
        const sfDomainSelect = document.getElementById('sfDomainSelect');
        function getSelectedSFDomain() {
            return (sfDomainSelect && sfDomainSelect.value !== undefined) ? (sfDomainSelect.value || DEFAULT_DOMAIN_KEY) : DEFAULT_DOMAIN_KEY;
        }

        let otpTimerId = null;
        let otpExpiresAt = 0;

        // expose a stopper to cancel timer when logging in
        window.__sfOtpTimerStop = function () {
            if (otpTimerId) {
                clearInterval(otpTimerId);
                otpTimerId = null;
            }
        };

        function updateOtpTimer() {
            if (!otpTimerEl) return;
            const remaining = Math.max(0, otpExpiresAt - Date.now());
            const sec = Math.ceil(remaining / 1000);
            otpTimerEl.textContent = remaining > 0 ? `(مهلت: ${sec} ثانیه)` : '(ارسال مجدد کد)';
            if (remaining <= 0) {
                if (verifyOtpBtn) verifyOtpBtn.disabled = true;
                if (sendOtpBtn) sendOtpBtn.disabled = false;
                clearInterval(otpTimerId);
                otpTimerId = null;
            } else {
                if (sendOtpBtn) sendOtpBtn.disabled = true;
            }
        }

        methodRadios.forEach((r) => {
            r.addEventListener('change', () => {
                const value = document.querySelector('input[name="sfLoginMethod"]:checked').value;
                if (value === 'password') {
                    pwdForm.style.display = '';
                    otpForm.style.display = 'none';
                } else {
                    pwdForm.style.display = 'none';
                    otpForm.style.display = '';
                    // Respect countdown state when switching to OTP view
                    if (sendOtpBtn) {
                        const remaining = Math.max(0, otpExpiresAt - Date.now());
                        sendOtpBtn.disabled = remaining > 0;
                    }
                }
            });
        });

        if (pwdLoginBtn) {
            pwdLoginBtn.addEventListener('click', async () => {
                const cellphone = document.getElementById('sfCellphonePwd').value.trim();
                const password = document.getElementById('sfPassword').value.trim();
                if (!cellphone || !password) {
                    appendLog('شماره یا رمز عبور وارد نشده است');
                    return;
                }
                const domainKey = getSelectedSFDomain();
                try {
                    appendLog('ورود با رمز عبور...');
                    const { token, expiryMs } = await sfLoginWithPassword({ cellphone, password });
                    saveSnappfoodToken(token, expiryMs, domainKey);
                    setSnappfoodStatusUI(domainKey, { token, expiry: typeof expiryMs === 'number' ? expiryMs : Date.now() + 7 * 24 * 60 * 60 * 1000 });
                    loadSnappfoodVendors(domainKey, async (vendors) => {
                        if (!vendors || vendors.length === 0) {
                            try {
                                appendLog('در حال دریافت لیست وندورها...');
                                const list = await fetchSnappfoodVendors({ token });
                                saveSnappfoodVendors(list, domainKey);
                            } catch (e2) {
                                appendLog(String(e2?.message || e2));
                            }
                        }
                    });
                } catch (e) {
                    appendLog(String(e?.message || e));
                }
            });
        }

        if (sendOtpBtn) {
            sendOtpBtn.addEventListener('click', async () => {
                const cellphone = document.getElementById('sfCellphoneOtp').value.trim();
                if (!cellphone) {
                    appendLog('شماره موبایل وارد نشده است');
                    return;
                }
                try {
                    appendLog('ارسال کد تایید...');
                    await sfSendOtp({ mobile_number: cellphone });
                    otpStep.style.display = '';
                    verifyOtpBtn.disabled = false;
                    // Disable send button during countdown
                    sendOtpBtn.disabled = true;
                    otpExpiresAt = Date.now() + 2 * 60 * 1000; // 2 minutes
                    if (otpTimerId) clearInterval(otpTimerId);
                    otpTimerId = setInterval(updateOtpTimer, 250);
                    updateOtpTimer();
                } catch (e) {
                    appendLog(String(e?.message || e));
                    // Re-enable if sending failed
                    sendOtpBtn.disabled = false;
                }
            });
        }

        if (verifyOtpBtn) {
            verifyOtpBtn.addEventListener('click', async () => {
                if (Date.now() > otpExpiresAt) {
                    appendLog('مهلت وارد کردن کد به پایان رسیده است');
                    verifyOtpBtn.disabled = true;
                    return;
                }
                const cellphone = document.getElementById('sfCellphoneOtp').value.trim();
                const otpCodeStr = document.getElementById('sfOtpCode').value.trim();
                if (!cellphone || !otpCodeStr) {
                    appendLog('شماره یا کد وارد نشده است');
                    return;
                }
                const otpCode = Number(otpCodeStr);
                if (!Number.isInteger(otpCode)) {
                    appendLog('کد باید عددی باشد');
                    return;
                }
                const domainKey = getSelectedSFDomain();
                try {
                    appendLog('تایید کد و ورود...');
                    const { token, expiryMs } = await sfVerifyOtp({ cellphone, otpCode });
                    saveSnappfoodToken(token, expiryMs, domainKey);
                    setSnappfoodStatusUI(domainKey, { token, expiry: typeof expiryMs === 'number' ? expiryMs : Date.now() + 7 * 24 * 60 * 60 * 1000 });
                    loadSnappfoodVendors(domainKey, async (vendors) => {
                        if (!vendors || vendors.length === 0) {
                            try {
                                appendLog('در حال دریافت لیست وندورها...');
                                const list = await fetchSnappfoodVendors({ token });
                                saveSnappfoodVendors(list, domainKey);
                            } catch (e2) {
                                appendLog(String(e2?.message || e2));
                            }
                        }
                    });
                } catch (e) {
                    appendLog(String(e?.message || e));
                }
            });
        }

        if (sfDomainSelect) {
            sfDomainSelect.addEventListener('change', () => {
                const key = sfDomainSelect.value || DEFAULT_DOMAIN_KEY;
                loadSnappfoodToken(key, (t) => setSnappfoodStatusUI(key, t));
            });
        }

        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                const key = (logoutBtn.dataset.domain !== undefined) ? logoutBtn.dataset.domain : (sfDomainSelect ? sfDomainSelect.value : '');
                const domainKey = key === undefined ? DEFAULT_DOMAIN_KEY : key;
                storageGet((d) => {
                    d = d || {};
                    const bt = (d.sf_token_by_domain && typeof d.sf_token_by_domain === 'object') ? { ...d.sf_token_by_domain } : {};
                    const be = (d.sf_token_expiry_by_domain && typeof d.sf_token_expiry_by_domain === 'object') ? { ...d.sf_token_expiry_by_domain } : {};
                    const bv = (d.sf_vendors_by_domain && typeof d.sf_vendors_by_domain === 'object') ? { ...d.sf_vendors_by_domain } : {};
                    delete bt[domainKey];
                    delete be[domainKey];
                    delete bv[domainKey];
                    const payload = {
                        [STORAGE_KEYS.sfTokenByDomain]: bt,
                        [STORAGE_KEYS.sfTokenExpiryByDomain]: be,
                        [STORAGE_KEYS.sfVendorsByDomain]: bv
                    };
                    if (domainKey === DEFAULT_DOMAIN_KEY) {
                        payload[STORAGE_KEYS.sfToken] = '';
                        payload[STORAGE_KEYS.sfTokenExpiry] = 0;
                        payload[STORAGE_KEYS.sfVendors] = [];
                    }
                    chrome.storage.sync.set(payload, () => {
                        setSnappfoodStatusUI(domainKey, { token: '', expiry: 0 });
                        refreshSFAccountsList();
                        appendLog('خروج از حساب اسنپ‌فود انجام شد');
                    });
                });
            });
        }
    });
})();


