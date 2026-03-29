const COMMON_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #e6edf3; min-height: 100vh; }
  .container { max-width: 640px; margin: 0 auto; padding: 40px 20px; }
  h1 { font-size: 28px; margin-bottom: 8px; color: #fff; }
  .subtitle { color: #8b949e; margin-bottom: 32px; }
  .form-group { margin-bottom: 20px; }
  label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; color: #c9d1d9; }
  input, textarea, select { width: 100%; padding: 10px 12px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #e6edf3; font-size: 14px; font-family: inherit; }
  input:focus, textarea:focus, select:focus { outline: none; border-color: #58a6ff; box-shadow: 0 0 0 3px rgba(88,166,255,0.15); }
  textarea { resize: vertical; min-height: 80px; }
  .checkbox-group { display: flex; flex-wrap: wrap; gap: 12px; }
  .checkbox-label { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 14px; }
  .checkbox-label input { width: auto; }
  button[type="submit"] { width: 100%; padding: 12px; background: #238636; border: 1px solid #2ea043; border-radius: 6px; color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 8px; }
  button[type="submit"]:hover { background: #2ea043; }
  button[type="submit"]:disabled { opacity: 0.6; cursor: not-allowed; }
  .error { background: #3d1f28; border: 1px solid #f85149; border-radius: 6px; padding: 12px; margin-bottom: 20px; color: #f85149; font-size: 14px; }
  .required { color: #f85149; }
  a { color: #58a6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
`;

export function signupPage(error?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FPVPIDlab Beta — Sign Up</title>
  <style>${COMMON_STYLES}</style>
</head>
<body>
  <div class="container">
    <h1>FPVPIDlab Beta</h1>
    <p class="subtitle">Sign up to test the next generation of FPV PID tuning</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <form method="POST" action="/beta/signup" id="betaForm">
      <div class="form-group">
        <label for="name">Name <span class="required">*</span></label>
        <input type="text" id="name" name="name" required maxlength="100" placeholder="Your name">
      </div>
      <div class="form-group">
        <label for="email">Email <span class="required">*</span></label>
        <input type="email" id="email" name="email" required maxlength="320" placeholder="you@example.com">
      </div>
      <div class="form-group">
        <label for="quad_count">How many quads do you fly? <span class="required">*</span></label>
        <select id="quad_count" name="quad_count" required>
          <option value="1">1</option>
          <option value="2">2-3</option>
          <option value="5" selected>4-6</option>
          <option value="10">7+</option>
        </select>
      </div>
      <div class="form-group">
        <label>Platform <span class="required">*</span></label>
        <div class="checkbox-group">
          <label class="checkbox-label"><input type="checkbox" name="platform" value="windows"> Windows</label>
          <label class="checkbox-label"><input type="checkbox" name="platform" value="macos"> macOS</label>
          <label class="checkbox-label"><input type="checkbox" name="platform" value="linux"> Linux</label>
        </div>
      </div>
      <div class="form-group">
        <label for="comment">Tell us about your FPV experience <span class="required">*</span></label>
        <textarea id="comment" name="comment" required maxlength="1000" placeholder="What quads do you fly? What flight controller firmware? Any tuning experience?"></textarea>
      </div>
      <button type="submit">Join the Beta Waitlist</button>
    </form>
  </div>
  <script>
    document.getElementById('betaForm').addEventListener('submit', function(e) {
      var platforms = document.querySelectorAll('input[name="platform"]:checked');
      if (platforms.length === 0) {
        e.preventDefault();
        alert('Please select at least one platform.');
      }
    });
  </script>
</body>
</html>`;
}

export function thankYouPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FPVPIDlab Beta — Thank You</title>
  <style>${COMMON_STYLES}
    .check { font-size: 48px; margin-bottom: 16px; }
    .message { font-size: 18px; line-height: 1.6; color: #c9d1d9; }
  </style>
</head>
<body>
  <div class="container" style="text-align: center; padding-top: 80px;">
    <div class="check">&#10003;</div>
    <h1>Application Received</h1>
    <p class="message" style="margin-top: 16px;">
      Thanks for signing up! We'll review your application and get back to you via email.
    </p>
    <p style="margin-top: 32px;"><a href="/beta">&larr; Back to signup</a></p>
  </div>
</body>
</html>`;
}

export function adminBetaPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FPVPIDlab Beta — Admin Dashboard</title>
  <style>
    ${COMMON_STYLES}
    .container { max-width: 1000px; }
    .auth-section { margin-bottom: 24px; }
    .auth-row { display: flex; gap: 8px; }
    .auth-row input { flex: 1; }
    .auth-row button { padding: 10px 20px; background: #238636; border: 1px solid #2ea043; border-radius: 6px; color: #fff; font-weight: 600; cursor: pointer; white-space: nowrap; }
    .auth-status { display: flex; align-items: center; gap: 12px; }
    .auth-status .badge-auth { background: #0d3117; color: #3fb950; padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: 600; }
    .btn-logout { padding: 6px 14px; background: transparent; border: 1px solid #30363d; border-radius: 6px; color: #8b949e; font-size: 13px; cursor: pointer; }
    .btn-logout:hover { border-color: #f85149; color: #f85149; }
    #content { display: none; }
    .stats { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .stat { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 20px; }
    .stat-value { font-size: 24px; font-weight: 700; color: #fff; }
    .stat-label { font-size: 12px; color: #8b949e; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #21262d; font-size: 14px; }
    th { color: #8b949e; font-weight: 600; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .badge-pending { background: #3d2e00; color: #d29922; }
    .badge-approved { background: #0d3117; color: #3fb950; }
    .badge-rejected { background: #3d1f28; color: #f85149; }
    .actions button { padding: 4px 12px; border-radius: 4px; border: 1px solid; cursor: pointer; font-size: 12px; font-weight: 600; margin-right: 4px; }
    .btn-approve { background: #238636; border-color: #2ea043; color: #fff; }
    .btn-approve:hover { background: #2ea043; }
    .btn-reject { background: #3d1f28; border-color: #f85149; color: #f85149; }
    .btn-reject:hover { background: #4d1f28; }
    .btn-approve:disabled, .btn-reject:disabled { opacity: 0.5; cursor: not-allowed; }
    .filter-row { display: flex; gap: 8px; margin-bottom: 16px; }
    .filter-row select { width: auto; }
    .empty { text-align: center; padding: 40px; color: #8b949e; }
    .license-key { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; color: #58a6ff; }
    .muted { color: #484f58; font-size: 13px; }
    .toast { position: fixed; top: 16px; right: 16px; padding: 12px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; z-index: 100; animation: fadeIn 0.2s; }
    .toast-success { background: #0d3117; color: #3fb950; border: 1px solid #238636; }
    .toast-warning { background: #3d2e00; color: #d29922; border: 1px solid #9e6a03; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
  </style>
</head>
<body>
  <div class="container">
    <h1>Beta Tester Dashboard</h1>
    <p class="subtitle">Manage beta tester applications</p>

    <div class="auth-section" id="authLogin">
      <label for="adminKey">Admin Key</label>
      <div class="auth-row">
        <input type="password" id="adminKey" placeholder="Enter admin key" autocomplete="off">
        <button onclick="authenticate()">Load</button>
      </div>
    </div>
    <div class="auth-section" id="authStatus" style="display:none;">
      <div class="auth-status">
        <span class="badge-auth">Authenticated</span>
        <button class="btn-logout" onclick="logout()">Logout</button>
      </div>
    </div>

    <div id="content">
      <div class="stats" id="stats"></div>

      <div class="filter-row">
        <select id="filterStatus" onchange="loadData()">
          <option value="">All statuses</option>
          <option value="pending" selected>Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Quads</th>
            <th>Platform</th>
            <th>Status</th>
            <th>License Key</th>
            <th>Last Used</th>
            <th>Date</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="tableBody"></tbody>
      </table>
      <div id="empty" class="empty" style="display:none;">No applications found.</div>
    </div>
  </div>

  <script>
    function getKey() {
      return sessionStorage.getItem('betaAdminKey') || '';
    }

    function api(method, path) {
      return fetch(path, {
        method: method,
        headers: { 'X-Admin-Key': getKey() }
      }).then(function(r) {
        if (r.status === 401) {
          logout();
          throw new Error('Invalid or expired admin key');
        }
        return r.json();
      });
    }

    function authenticate() {
      var input = document.getElementById('adminKey');
      var key = input.value;
      if (!key) return;

      // Trim whitespace (common with copy-paste)
      key = key.trim();
      if (!key) return;

      // Store in sessionStorage (cleared on tab close), clear input immediately
      sessionStorage.setItem('betaAdminKey', key);
      input.value = '';

      loadData();
    }

    function showAuthState(authenticated) {
      document.getElementById('authLogin').style.display = authenticated ? 'none' : 'block';
      document.getElementById('authStatus').style.display = authenticated ? 'block' : 'none';
    }

    function logout() {
      sessionStorage.removeItem('betaAdminKey');
      showAuthState(false);
      // Clear sensitive PII from DOM
      document.getElementById('stats').innerHTML = '';
      document.getElementById('tableBody').innerHTML = '';
      document.getElementById('empty').style.display = 'none';
      document.getElementById('content').style.display = 'none';
    }

    function loadData() {
      if (!getKey()) return;

      var status = document.getElementById('filterStatus').value;
      var qs = status ? '?status=' + status : '';

      api('GET', '/admin/beta/list' + qs).then(function(data) {
        showAuthState(true);
        document.getElementById('content').style.display = 'block';
        renderStats(data.stats);
        renderTable(data.entries);
      }).catch(function(err) {
        alert(err.message);
      });
    }

    function renderStats(s) {
      var el = document.getElementById('stats');
      el.innerHTML = '';
      var items = [
        ['Pending', s.pending],
        ['Approved', s.approved],
        ['Rejected', s.rejected],
        ['Total', s.total]
      ];
      items.forEach(function(item) {
        var div = document.createElement('div');
        div.className = 'stat';
        var val = document.createElement('div');
        val.className = 'stat-value';
        val.textContent = item[1];
        var label = document.createElement('div');
        label.className = 'stat-label';
        label.textContent = item[0];
        div.appendChild(val);
        div.appendChild(label);
        el.appendChild(div);
      });
    }

    function renderTable(entries) {
      var tbody = document.getElementById('tableBody');
      var empty = document.getElementById('empty');
      tbody.innerHTML = '';

      if (entries.length === 0) {
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';

      entries.forEach(function(e) {
        var tr = document.createElement('tr');
        tr.id = 'row-' + e.id;

        // Name
        var td0 = document.createElement('td');
        td0.textContent = e.name;
        tr.appendChild(td0);

        // Email
        var td1 = document.createElement('td');
        td1.textContent = e.email;
        tr.appendChild(td1);

        // Quads
        var td2 = document.createElement('td');
        td2.textContent = e.quadCount;
        tr.appendChild(td2);

        // Platform
        var td3 = document.createElement('td');
        td3.textContent = e.platform;
        tr.appendChild(td3);

        // Status badge
        var td4 = document.createElement('td');
        var badge = document.createElement('span');
        badge.className = 'badge badge-' + e.status;
        badge.textContent = e.status;
        td4.appendChild(badge);
        tr.appendChild(td4);

        // License Key
        var td5 = document.createElement('td');
        if (e.licenseKey) {
          var keySpan = document.createElement('span');
          keySpan.className = 'license-key';
          keySpan.textContent = e.licenseKey;
          td5.appendChild(keySpan);
        } else {
          td5.className = 'muted';
          td5.textContent = '-';
        }
        tr.appendChild(td5);

        // Last Used
        var td6 = document.createElement('td');
        if (e.lastUsedAt) {
          td6.textContent = new Date(e.lastUsedAt).toLocaleDateString();
        } else if (e.activatedAt) {
          td6.textContent = new Date(e.activatedAt).toLocaleDateString();
        } else if (e.licenseKey) {
          td6.className = 'muted';
          td6.textContent = 'not activated';
        } else {
          td6.className = 'muted';
          td6.textContent = '-';
        }
        tr.appendChild(td6);

        // Date
        var td7 = document.createElement('td');
        td7.textContent = new Date(e.createdAt).toLocaleDateString();
        tr.appendChild(td7);

        // Actions
        var td8 = document.createElement('td');
        td8.className = 'actions';
        if (e.status === 'pending') {
          var approveBtn = document.createElement('button');
          approveBtn.className = 'btn-approve';
          approveBtn.textContent = 'Approve';
          approveBtn.onclick = function() { doAction(e.id, 'approve', this); };
          var rejectBtn = document.createElement('button');
          rejectBtn.className = 'btn-reject';
          rejectBtn.textContent = 'Reject';
          rejectBtn.onclick = function() { doAction(e.id, 'reject', this); };
          td8.appendChild(approveBtn);
          td8.appendChild(rejectBtn);
        }
        tr.appendChild(td8);

        // Comment row
        var commentTr = document.createElement('tr');
        var commentTd = document.createElement('td');
        commentTd.colSpan = 9;
        commentTd.style.cssText = 'padding: 4px 12px 12px; color: #8b949e; font-size: 13px; border-bottom: 1px solid #30363d;';
        commentTd.textContent = e.comment;
        commentTr.appendChild(commentTd);

        tbody.appendChild(tr);
        tbody.appendChild(commentTr);
      });
    }

    function showToast(message, type) {
      var existing = document.querySelector('.toast');
      if (existing) existing.remove();
      var toast = document.createElement('div');
      toast.className = 'toast toast-' + type;
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(function() { toast.remove(); }, 4000);
    }

    function doAction(id, action, btn) {
      btn.disabled = true;
      api('PUT', '/admin/beta/' + id + '/' + action).then(function(data) {
        if (data.emailSent === false) {
          showToast('Action completed but email failed to send.', 'warning');
        } else {
          showToast(action === 'approve' ? 'Approved — license key sent via email.' : 'Rejected.', 'success');
        }
        loadData();
      }).catch(function(err) {
        alert('Failed: ' + err.message);
        btn.disabled = false;
      });
    }

    // Allow Enter to trigger authenticate
    document.getElementById('adminKey').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') authenticate();
    });

    // Auto-load if session key exists (e.g. page refresh)
    if (getKey()) loadData();
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
