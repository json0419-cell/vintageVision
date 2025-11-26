// frontend/nav-auth.js

// 这个文件会在所有页面运行：
// 1. 调用 /api/auth/me 判断是否已登录
// 2. 如果已登录：把右上角 "Sign In" 换成头像 + 下拉菜单
// 3. 如果当前页有 “Try it now” 按钮，就根据登录状态跳转不同页面

document.addEventListener('DOMContentLoaded', async () => {
    let loggedIn = false;
    let user = null;

    // 1. 查询当前登录状态
    try {
        const res = await fetch('/api/auth/me', {
            credentials: 'include',  // ⭐ 必须带 cookie 才能识别登录
        });

        if (res.ok) {
            user = await res.json();
            loggedIn = true;
            console.log('nav-auth: logged in as', user);
        } else {
            console.log('nav-auth: not logged in');
        }
    } catch (err) {
        console.error('nav-auth: /api/auth/me error', err);
    }

    // 2. 处理 navbar 右上角
    // 请在每个页面的 navbar 里给 "Sign In" 那个 <li> 加 id="navAuthItem"
    const navAuthItem = document.getElementById('navAuthItem');

    if (navAuthItem) {
        if (loggedIn && user) {
            // 已登录：显示圆形头像 + 下拉菜单
            const avatarUrl = user.picture || 'images/default-avatar.png';
            const displayName = user.name || user.email || 'User';

            navAuthItem.innerHTML = `
        <div class="dropdown">
          <a href="#" class="d-flex align-items-center text-decoration-none dropdown-toggle"
             id="navUserDropdown" data-bs-toggle="dropdown" aria-expanded="false">
            <img src="${avatarUrl}" alt="avatar"
                 class="rounded-circle me-2" width="32" height="32"
                 style="object-fit: cover;">
          </a>
          <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="navUserDropdown">
            <li><h6 class="dropdown-header mb-0">${displayName}</h6></li>
            <li>
              <a class="dropdown-item" href="dashboard.html">
                <i class="bi bi-speedometer2 me-2"></i>Dashboard
              </a>
            </li>
            <li>
              <button class="dropdown-item" id="navChoosePhotosBtn" type="button">
                <i class="bi bi-images me-2"></i>Choose more photos
              </button>
            </li>
            <li><hr class="dropdown-divider"></li>
            <li>
              <button class="dropdown-item" id="navLogoutBtn" type="button">
                <i class="bi bi-box-arrow-right me-2"></i>Log out
              </button>
            </li>
          </ul>
        </div>
      `;

            // 下拉菜单里的"Choose more photos"
            const choosePhotosBtn = document.getElementById('navChoosePhotosBtn');
            if (choosePhotosBtn) {
                choosePhotosBtn.addEventListener('click', (e) => {
                    e.preventDefault();

                    // 如果当前就是 dashboard 页面，而且 dashboard.js 已经挂了 openPhotosPicker，
                    // 那就直接调用它 → 等价于点 "Choose from Google Photos" 按钮
                    const isOnDashboard =
                        window.location.pathname.endsWith('/dashboard.html') ||
                        window.location.pathname.endsWith('dashboard.html');

                    if (isOnDashboard && typeof window.openPhotosPicker === 'function') {
                        window.openPhotosPicker();
                    } else {
                        // 不在 dashboard，先跳到 dashboard，并添加参数标记需要自动打开 picker
                        window.location.href = 'dashboard.html?openPicker=true';
                    }
                });
            }

            // 退出登录 → 调用后端 /api/auth/logout 清 cookie，然后回首页
            const logoutBtn = document.getElementById('navLogoutBtn');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', async () => {
                    try {
                        await fetch('/api/auth/logout', {
                            method: 'POST',
                            credentials: 'include',   // ⭐ 必须带 cookie，让后端知道清谁
                        });
                    } catch (err) {
                        console.error('logout error:', err);
                    }

                    window.location.href = 'index.html';
                });
            }
        } else {
            // 未登录：保证还是显示 Sign In 链接
            navAuthItem.innerHTML = `
        <a class="nav-link" href="signin.html">Sign In</a>
      `;
        }
    }

    // 3. 处理 Home 页上的 “Try it now” 按钮
    // 请在 index.html 把按钮设成 id="tryItNowBtn"
    const tryItBtn = document.getElementById('tryItNowBtn');
    if (tryItBtn) {
        tryItBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (loggedIn) {
                window.location.href = 'dashboard.html';
            } else {
                window.location.href = 'signin.html';
            }
        });
    }
});
