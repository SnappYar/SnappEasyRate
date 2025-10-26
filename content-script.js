(function () {
    // Toast notification system
    function showToast(message, type = 'error', duration = 5000) {
        // Remove existing toasts
        document.querySelectorAll('.snappyar-toast').forEach(toast => toast.remove());
        
        const toast = document.createElement('div');
        toast.className = 'snappyar-toast';
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6'};
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            font-family: IRANSans, -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 14px;
            max-width: 400px;
            word-wrap: break-word;
            animation: slideIn 0.3s ease-out;
        `;
        
        // Add animation styles
        if (!document.querySelector('#snappyar-toast-styles')) {
            const style = document.createElement('style');
            style.id = 'snappyar-toast-styles';
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes slideOut {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
        
        toast.textContent = message;
        document.body.appendChild(toast);
        
        // Auto remove after duration
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => toast.remove(), 300);
        }, duration);
        
        // Click to dismiss
        toast.addEventListener('click', () => {
            toast.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => toast.remove(), 300);
        });
    }
    
    function getOwnText(el) {
        if (!el) return '';
        const parts = [];
        el.childNodes.forEach(n => { if (n.nodeType === 3) parts.push(n.nodeValue || ''); });
        return parts.join(' ').replace(/[\u200c\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim();
    }
    
    // Local storage functions for tracking sent SMS
    function getSentSMS() {
        try {
            const stored = localStorage.getItem('snappyar_sent_sms');
            return stored ? JSON.parse(stored) : [];
        } catch (e) {
            return [];
        }
    }
    
    function saveSentSMS(orderId, type = 'sms') {
        try {
            const sent = getSentSMS();
            const key = `${orderId}_${type}`;
            if (!sent.includes(key)) {
                sent.push(key);
                localStorage.setItem('snappyar_sent_sms', JSON.stringify(sent));
            }
        } catch (e) {
            console.error('Error saving sent SMS:', e);
        }
    }
    
    function isSMSSent(orderId, type = 'sms') {
        try {
            const sent = getSentSMS();
            const key = `${orderId}_${type}`;
            return sent.includes(key);
        } catch (e) {
            return false;
        }
    }

    function findTargetTableBodies() {
        const bodies = Array.from(document.querySelectorAll('tbody'));
        return bodies.filter(tb => {
            const headerRow = tb.querySelector('tr');
            if (!headerRow) return false;
            const ths = Array.from(headerRow.querySelectorAll('th'));
            const names = ths.map(th => th.getAttribute('data-name'));
            return names.includes('VUserName') && names.includes('FirstName') && names.includes('Price') && names.includes('TrackingCode');
        });
    }

    function ensureHeaderHasSmsColumn(tbody) {
        const headerRow = tbody.querySelector('tr');
        if (!headerRow) return;
        const ths = Array.from(headerRow.querySelectorAll('th'));
        const vUserIndex = ths.findIndex(th => th.getAttribute('data-name') === 'VUserName');
        if (vUserIndex === -1) return;
        
        // Check for existing SMS columns
        const smsExists = headerRow.querySelector('th[data-name="SmsAction"]');
        const aggregateExists = headerRow.querySelector('th[data-name="AggregateAction"]');
        
        if (!smsExists) {
            const th = document.createElement('th');
            th.setAttribute('data-name', 'SmsAction');
            th.textContent = 'ارسال پیامک';
            // insert after VUserName column
            if (headerRow.children[vUserIndex + 1]) {
                headerRow.insertBefore(th, headerRow.children[vUserIndex + 1]);
            } else {
                headerRow.appendChild(th);
            }
        }
        
        if (!aggregateExists) {
            const th2 = document.createElement('th');
            th2.setAttribute('data-name', 'AggregateAction');
            th2.textContent = 'ارسال تجمیعی';
            // insert after SMS column
            const smsColumn = headerRow.querySelector('th[data-name="SmsAction"]');
            if (smsColumn && smsColumn.nextSibling) {
                headerRow.insertBefore(th2, smsColumn.nextSibling);
            } else if (smsColumn) {
                headerRow.appendChild(th2);
            } else {
                // fallback: insert after VUserName
                if (headerRow.children[vUserIndex + 1]) {
                    headerRow.insertBefore(th2, headerRow.children[vUserIndex + 1]);
                } else {
                    headerRow.appendChild(th2);
                }
            }
        }
    }

    function addButtonsToRows(tbody) {
        const rows = Array.from(tbody.querySelectorAll('tr'));
        // skip header (first tr has th children)
        rows.slice(1).forEach(row => {
            const firstNameCell = row.querySelector('td[data-name="FirstName"]');
            const priceCell = row.querySelector('td[data-name="Price"]');
            const vUserNameCell = row.querySelector('td[data-name="VUserName"]');
            const trackingCodeCell = row.querySelector('td[data-name="TrackingCode"]');
            const branchNameCell = row.querySelector('td[data-name="BranchName"]');
            const dateTimeCell = row.querySelector('td[data-name="DateTime"]');
            if (!firstNameCell || !priceCell || !vUserNameCell || !trackingCodeCell) return;
            
            // Get OrderID from data-id attribute
            const orderId = row.getAttribute('data-id') || '';
            // console.log('OrderID found:', orderId);

            // Avoid duplicate cells
            const existingSmsCell = row.querySelector('td[data-name="SmsAction"]');
            const existingAggregateCell = row.querySelector('td[data-name="AggregateAction"]');
            if (existingSmsCell && existingAggregateCell) return;

            // First column - ارسال پیامک
            let td = null;
            if (!existingSmsCell) {
                td = document.createElement('td');
                td.setAttribute('data-name', 'SmsAction');
                
                const btn = document.createElement('button');
                btn.className = 'sf-sms-btn';
                btn.textContent = 'ارسال پیامک';
                btn.style.padding = '3px 8px';
                btn.style.borderRadius = '6px';
                btn.style.border = '1px solid #15803d';
                btn.style.background = '#16a34a';
                btn.style.color = '#ffffff';
                btn.style.cursor = 'pointer';
                btn.style.whiteSpace = 'nowrap';
                btn.style.fontSize = '11px';
                btn.disabled = false;
                // Enable only if trackingCode is exactly "snappfood"
                const trackingRaw = trackingCodeCell ? (trackingCodeCell.innerText || '').trim() : '';
                const trackingNorm = trackingRaw.toLowerCase();
                if (trackingNorm !== 'snappfood') {
                    btn.disabled = true;
                    btn.style.background = '#9ca3af';
                    btn.style.border = '1px solid #9ca3af';
                    btn.style.cursor = 'not-allowed';
                } else if (orderId && isSMSSent(orderId, 'sms')) {
                    // Already sent, show as sent
                    btn.disabled = true;
                    btn.textContent = 'ارسال شد!';
                    btn.style.background = '#10b981';
                    btn.style.border = '1px solid #10b981';
                    btn.style.cursor = 'not-allowed';
                }
            btn.addEventListener('click', async () => {
                if (btn.disabled) return;
                console.log('SMS button clicked');
                const firstName = firstNameCell.innerText.replace(/\s+/g, ' ').trim();
                const price = priceCell.innerText.replace(/\s+/g, ' ').trim();
                const vUserName = (vUserNameCell.innerText || '').replace(/\s+/g, ' ').trim();
                const trackingCode = trackingCodeCell.innerText.replace(/\s+/g, ' ').trim();
                const branchName = branchNameCell ? getOwnText(branchNameCell) : '';
                const dateTime = dateTimeCell ? getOwnText(dateTimeCell) : '';
                function normalize(str) { return (str || '').replace(/[\u200c\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim(); }

                const dateTimeG = jalaliToGregorian(dateTime);

                const prevText = btn.textContent; btn.disabled = true; btn.textContent = 'در حال پردازش...';
                chrome.storage.sync.get(['sf_vendors', 'sf_token'], async (data) => {
                    try {
                        const vendors = Array.isArray(data['sf_vendors']) ? data['sf_vendors'] : [];
                        const bn = normalize(branchName);
                        let match = null;
                        for (const v of vendors) {
                            const title = normalize(v.title);
                            if (!title) continue;
                            if (title.includes(`(${bn})`) || title === bn || (bn && title.includes(bn))) { match = v; break; }
                        }
                        const vendorId = match ? match.id : '';

                        const token = `Bearer ${data['sf_token']}`;
                        // console.log('normalize(branchName):', normalize(branchName));
                        // console.log('sf_token:', token);
                        // console.log('vendorId:', vendorId);

                        if (vendorId && token && dateTimeG) {
                            const start = `${dateTimeG} 00:00:00`;
                            const end = `${dateTimeG} 23:59:00`;
                            const url = `https://vendor.snappfood.ir/vms/v2/order/list?vendorId=${encodeURIComponent(vendorId)}&pageSize=20&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}&page=0`;
                            const { ok, status, text, error } = await chrome.runtime.sendMessage({
                                type: 'SF_FETCH',
                                url,
                                method: 'GET',
                                headers: { Authorization: token }
                            });
                            if (!ok) {
                                showToast(`خطا در دریافت سفارشات: ${status} - ${decodeUnicode(error) || text}`, 'error');
                                btn.textContent = 'خطا در دریافت سفارشات';
                                btn.disabled = false;
                                return;
                            } else {
                                let response = {};
                                try { response = JSON.parse(text) || {}; } catch (_) { }
                                // console.log('API response:', response);

                                // Handle different response structures
                                let orders = [];
                                if (Array.isArray(response)) {
                                    orders = response;
                                } else if (Array.isArray(response.data)) {
                                    orders = response.data;
                                } else if (Array.isArray(response.included)) {
                                    orders = response.included.filter(item => item.type === 'order');
                                }

                                const target = orders.find(x => normalize(x?.attributes?.customerName) === normalize(firstName));
                                // console.log({ firstName, price, vUserName, trackingCode, branchName, vendorId, dateTimeG, matchedOrder: target || null, totalOrders: orders.length });

                                if (!target?.attributes?.code) {
                                    showToast(`خطا: سفارش برای ${firstName} پیدا نشد`, 'error');
                                    btn.textContent = 'سفارش پیدا نشد';
                                    btn.disabled = false;
                                    return;
                                }

                                const targetCode = target?.attributes?.code;
                                console.log('targetCode:', targetCode);

                                const URL_OVERRIDE_FOR_TEMPLATE = `https://link.sib360.com/${targetCode}`;
                                chrome.storage.sync.get(['sms_template'], (d) => {
                                    const tpl = typeof d['sms_template'] === 'string' ? d['sms_template'] : '';
                                    if (!tpl) {
                                        showToast('خطا: متن پیامک تنظیم نشده است - لطفاً در تنظیمات متن پیامک را وارد کنید', 'error');
                                        btn.textContent = 'متن تنظیم نشده';
                                        btn.disabled = false;
                                        return;
                                    }
                                    let smsText = tpl.replace(/\{url\}/g, URL_OVERRIDE_FOR_TEMPLATE || '{url}');
                                    smsText = smsText.replace(/\{name\}/g, firstName || '{name}');
                                    console.log('SMS text preview:', smsText);

                                    // Prepare to send SMS: add a leading 0 to vUserName
                                    const phone = vUserName ? ('0' + vUserName.replace(/^0+/, '')) : '';
                                    if (!phone) {
                                        showToast('خطا: شماره مشتری موجود نیست', 'error');
                                        btn.textContent = 'شماره موجود نیست';
                                        btn.disabled = false;
                                        return;
                                    }

                                    chrome.storage.sync.get(['sms_api_url', 'sms_auth_token'], async (cfg) => {
                                        const apiUrl = cfg['sms_api_url'] || '';
                                        const authToken = cfg['sms_auth_token'] || '';
                                        if (!apiUrl || !authToken) {
                                            showToast('خطا: API URL یا توکن تنظیم نشده است - لطفاً در تنظیمات API را وارد کنید', 'error');
                                            btn.textContent = 'API تنظیم نشده';
                                            btn.disabled = false;
                                            return;
                                        }
                                        try {
                                            const payload = {
                                                ProviderId: 1,
                                                Number: phone,
                                                Message: smsText
                                            };
                                            const { ok, status, text, error } = await chrome.runtime.sendMessage({
                                                type: 'SF_FETCH',
                                                url: apiUrl,
                                                method: 'POST',
                                                headers: { 'Authorization': authToken, 'Content-Type': 'application/json' },
                                                body: payload
                                            });
                                            if (!ok || (status && status >= 300)) {
                                                showToast(`خطا در ارسال پیامک: ${status} - ${decodeUnicode(error) || text}`, 'error');
                                                btn.textContent = 'ارسال ناموفق';
                                                btn.disabled = false;
                                            } else {
                                                showToast(`پیامک با موفقیت به ${phone} ارسال شد`, 'success');
                                                btn.textContent = `ارسال شد!`;
                                                btn.disabled = true;
                                                // Save to localStorage
                                                if (orderId) {
                                                    saveSentSMS(orderId, 'sms');
                                                }
                                            }
                                        } catch (e) {
                                            showToast(`خطا در ارسال پیامک: ${e.message || e}`, 'error');
                                            btn.textContent = 'خطا در ارسال';
                                            btn.disabled = false;
                                        }
                                    });
                                });
                            }
                        } else {
                            //console.log({ firstName, price, vUserName, trackingCode, branchName, vendorId, dateTimeG, note: 'vendorId/token/dateTimeG missing' });
                        }
                    } catch (e) {
                        showToast(`خطای غیرمنتظره: ${e.message || e}`, 'error');
                        btn.textContent = 'خطا';
                        btn.disabled = false;
                    }
                });
            });
            
            td.appendChild(btn);
            // Insert first column
            if (vUserNameCell.nextSibling) {
                vUserNameCell.parentNode.insertBefore(td, vUserNameCell.nextSibling);
            } else {
                vUserNameCell.parentNode.appendChild(td);
            }
            }
            
            // Second column - ارسال تجمیعی
            if (!existingAggregateCell) {
                const td2 = document.createElement('td');
                td2.setAttribute('data-name', 'AggregateAction');
                
                const btn2 = document.createElement('button');
                btn2.className = 'sf-sms-btn';
                btn2.textContent = 'ارسال تجمیعی';
                btn2.style.padding = '3px 8px';
                btn2.style.borderRadius = '6px';
                btn2.style.border = '1px solid #7c3aed';
                btn2.style.background = '#8b5cf6';
                btn2.style.color = '#ffffff';
                btn2.style.cursor = 'pointer';
                btn2.style.whiteSpace = 'nowrap';
                btn2.style.fontSize = '11px';
                btn2.disabled = false;
                
                // Enable only if trackingCode is exactly "snappfood"
                const trackingRaw = trackingCodeCell ? (trackingCodeCell.innerText || '').trim() : '';
                const trackingNorm = trackingRaw.toLowerCase();
                if (trackingNorm !== 'snappfood') {
                    btn2.disabled = true;
                    btn2.style.background = '#9ca3af';
                    btn2.style.border = '1px solid #9ca3af';
                    btn2.style.cursor = 'not-allowed';
                } else if (orderId && isSMSSent(orderId, 'aggregate')) {
                    // Already sent, show as sent
                    btn2.disabled = true;
                    btn2.textContent = 'ارسال شد!';
                    btn2.style.background = '#10b981';
                    btn2.style.border = '1px solid #10b981';
                    btn2.style.cursor = 'not-allowed';
                }
                
                // Event listener for aggregate button
                btn2.addEventListener('click', async () => {
                    if (btn2.disabled) return;
                    console.log('Aggregate SMS button clicked');
                    const firstName = firstNameCell.innerText.replace(/\s+/g, ' ').trim();
                    const price = priceCell.innerText.replace(/\s+/g, ' ').trim();
                    const vUserName = (vUserNameCell.innerText || '').replace(/\s+/g, ' ').trim();
                    const trackingCode = trackingCodeCell.innerText.replace(/\s+/g, ' ').trim();
                    const branchName = branchNameCell ? getOwnText(branchNameCell) : '';
                    const dateTime = dateTimeCell ? getOwnText(dateTimeCell) : '';

                    function normalize(str) { return (str || '').replace(/[\u200c\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim(); }

                    const dateTimeG = jalaliToGregorian(dateTime);

                    const prevText = btn2.textContent; btn2.disabled = true; btn2.textContent = 'در حال پردازش...';
                    chrome.storage.sync.get(['sf_vendors', 'sf_token'], async (data) => {
                        try {
                            const vendors = Array.isArray(data['sf_vendors']) ? data['sf_vendors'] : [];
                            const bn = normalize(branchName);
                            let match = null;
                            for (const v of vendors) {
                                const title = normalize(v.title);
                                if (!title) continue;
                                if (title.includes(`(${bn})`) || title === bn || (bn && title.includes(bn))) { match = v; break; }
                            }
                            const vendorId = match ? match.id : '';

                            const token = `Bearer ${data['sf_token']}`;

                            if (vendorId && token && dateTimeG) {
                                const start = `${dateTimeG} 00:00:00`;
                                const end = `${dateTimeG} 23:59:00`;
                                const url = `https://vendor.snappfood.ir/vms/v2/order/list?vendorId=${encodeURIComponent(vendorId)}&pageSize=20&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}&page=0`;
                                const { ok, status, text, error } = await chrome.runtime.sendMessage({
                                    type: 'SF_FETCH',
                                    url,
                                    method: 'GET',
                                    headers: { Authorization: token }
                                });
                            if (!ok) {
                                showToast(`خطا در دریافت سفارشات: ${status} - ${decodeUnicode(error) || text}`, 'error');
                                btn2.textContent = 'خطا در دریافت سفارشات';
                                btn2.disabled = false;
                                return;
                            } else {
                                    let response = {};
                                    try { response = JSON.parse(text) || {}; } catch (_) { }

                                    // Handle different response structures
                                    let orders = [];
                                    if (Array.isArray(response)) {
                                        orders = response;
                                    } else if (Array.isArray(response.data)) {
                                        orders = response.data;
                                    } else if (Array.isArray(response.included)) {
                                        orders = response.included.filter(item => item.type === 'order');
                                    }

                                    const target = orders.find(x => normalize(x?.attributes?.customerName) === normalize(firstName));

                                    if (!target?.attributes?.code) {
                                        showToast(`خطا: سفارش برای ${firstName} پیدا نشد`, 'error');
                                        btn2.textContent = 'سفارش پیدا نشد';
                                        btn2.disabled = false;
                                        return;
                                    }

                                    const targetCode = target?.attributes?.code;
                                    console.log('targetCode:', targetCode);

                                    // Use aggregate URL instead of individual order URL
                                    const URL_OVERRIDE_FOR_TEMPLATE = `https://link.sib360.com`;
                                    chrome.storage.sync.get(['sms_template'], (d) => {
                                        const tpl = typeof d['sms_template'] === 'string' ? d['sms_template'] : '';
                                        if (!tpl) {
                                            showToast('خطا: متن پیامک تنظیم نشده است - لطفاً در تنظیمات متن پیامک را وارد کنید', 'error');
                                            btn2.textContent = 'متن تنظیم نشده';
                                            btn2.disabled = false;
                                            return;
                                        }
                                        let smsText = tpl.replace(/\{url\}/g, URL_OVERRIDE_FOR_TEMPLATE || '{url}');
                                        smsText = smsText.replace(/\{name\}/g, firstName || '{name}');
                                        console.log('Aggregate SMS text preview:', smsText);

                                        // Prepare to send SMS: add a leading 0 to vUserName
                                        const phone = vUserName ? ('0' + vUserName.replace(/^0+/, '')) : '';
                                        if (!phone) {
                                            showToast('خطا: شماره مشتری موجود نیست', 'error');
                                            btn2.textContent = 'شماره موجود نیست';
                                            btn2.disabled = false;
                                            return;
                                        }

                                        chrome.storage.sync.get(['sms_api_url', 'sms_auth_token'], async (cfg) => {
                                            const apiUrl = cfg['sms_api_url'] || '';
                                            const authToken = cfg['sms_auth_token'] || '';
                                            if (!apiUrl || !authToken) {
                                                showToast('خطا: API URL یا توکن تنظیم نشده است - لطفاً در تنظیمات API را وارد کنید', 'error');
                                                btn2.textContent = 'API تنظیم نشده';
                                                btn2.disabled = false;
                                                return;
                                            }
                                            try {
                                                const payload = {
                                                    ProviderId: 1,
                                                    Number: phone,
                                                    Message: smsText
                                                };
                                                const { ok, status, text, error } = await chrome.runtime.sendMessage({
                                                    type: 'SF_FETCH',
                                                    url: apiUrl,
                                                    method: 'POST',
                                                    headers: { 'Authorization': authToken, 'Content-Type': 'application/json' },
                                                    body: payload
                                                });
                                                if (!ok || (status && status >= 300)) {
                                                    showToast(`خطا در ارسال پیامک: ${status} - ${decodeUnicode(error) || text}`, 'error');
                                                    btn2.textContent = 'ارسال ناموفق';
                                                    btn2.disabled = false;
                                                } else {
                                                    showToast(`پیامک تجمیعی با موفقیت به ${phone} ارسال شد`, 'success');
                                                    btn2.textContent = `ارسال شد!`;
                                                    btn2.disabled = true;
                                                    // Save to localStorage
                                                    if (orderId) {
                                                        saveSentSMS(orderId, 'aggregate');
                                                    }
                                                }
                                            } catch (e) {
                                                showToast(`خطا در ارسال پیامک: ${e.message || e}`, 'error');
                                                btn2.textContent = 'خطا در ارسال';
                                                btn2.disabled = false;
                                            }
                                        });
                                    });
                                }
                            } else {
                                //console.log({ firstName, price, vUserName, trackingCode, branchName, vendorId, dateTimeG, note: 'vendorId/token/dateTimeG missing' });
                            }
                        } catch (e) {
                            showToast(`خطای غیرمنتظره: ${e.message || e}`, 'error');
                            btn2.textContent = 'خطا';
                            btn2.disabled = false;
                        }
                    });
                });
                
                td2.appendChild(btn2);
                // Insert second column after first SMS column
                const smsCell = row.querySelector('td[data-name="SmsAction"]');
                if (smsCell && smsCell.nextSibling) {
                    smsCell.parentNode.insertBefore(td2, smsCell.nextSibling);
                } else if (smsCell) {
                    smsCell.parentNode.appendChild(td2);
                } else {
                    // fallback: insert after VUserName
                    if (vUserNameCell.nextSibling) {
                        vUserNameCell.parentNode.insertBefore(td2, vUserNameCell.nextSibling);
                    } else {
                        vUserNameCell.parentNode.appendChild(td2);
                    }
                }
            }
        });
    }

    function process() {
        const bodies = findTargetTableBodies();
        bodies.forEach(tb => {
            ensureHeaderHasSmsColumn(tb);
            addButtonsToRows(tb);
        });
    }

    // Initial run
    process();

    // Observe for dynamic changes
    const observer = new MutationObserver(() => {
        try { process(); } catch (e) { }
    });
    observer.observe(document.documentElement, { subtree: true, childList: true });

    function jalaliToGregorian(dateTimeStr) {
        // حذف متن فارسی "در ساعت"
        const cleaned = dateTimeStr.replace("در ساعت", "").trim();

        // جدا کردن تاریخ و زمان
        const [datePart] = cleaned.split(" ");
        const [jy, jm, jd] = datePart.split("/").map(Number);

        // تبدیل به میلادی
        const { gy, gm, gd } = jalaali.toGregorian(jy, jm, jd);

        // برگردوندن خروجی به فرمت YYYY-M-D
        return `${gy}-${gm}-${gd}`;
    }
})();

function decodeUnicode(str) {
    try {
      return decodeURIComponent(JSON.parse(`"${str}"`));
    } catch {
      return str;
    }
  }