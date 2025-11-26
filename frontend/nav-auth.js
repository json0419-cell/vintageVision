// frontend/nav-auth.js

// This file runs on all pages:
// 1. Call /api/auth/me to check if logged in
// 2. If logged in: Replace "Sign In" with avatar + dropdown menu
// 3. If current page has "Try it now" button, navigate to different pages based on login status

document.addEventListener('DOMContentLoaded', async () => {
    let loggedIn = false;
    let user = null;

    // 1. Check current login status
    try {
        const res = await fetch('/api/auth/me', {
            credentials: 'include',  // ⭐ Must include cookie to identify login
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

    // 2. Handle navbar top-right corner
    // Please add id="navAuthItem" to the "Sign In" <li> in navbar on each page
    const navAuthItem = document.getElementById('navAuthItem');

    if (navAuthItem) {
        if (loggedIn && user) {
            // Logged in: Show circular avatar + dropdown menu
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

            // "Choose more photos" in dropdown menu
            const choosePhotosBtn = document.getElementById('navChoosePhotosBtn');
            if (choosePhotosBtn) {
                choosePhotosBtn.addEventListener('click', (e) => {
                    e.preventDefault();

                    // If currently on dashboard page and dashboard.js has openPhotosPicker,
                    // call it directly → equivalent to clicking "Choose from Google Photos" button
                    const isOnDashboard =
                        window.location.pathname.endsWith('/dashboard.html') ||
                        window.location.pathname.endsWith('dashboard.html');

                    if (isOnDashboard && typeof window.openPhotosPicker === 'function') {
                        window.openPhotosPicker();
                    } else {
                        // Not on dashboard, navigate to dashboard first, add parameter to auto-open picker
                        window.location.href = 'dashboard.html?openPicker=true';
                    }
                });
            }

            // Logout → Call backend /api/auth/logout to clear cookies, then return to home page
            const logoutBtn = document.getElementById('navLogoutBtn');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', async () => {
                    try {
                        await fetch('/api/auth/logout', {
                            method: 'POST',
                            credentials: 'include',   // ⭐ Must include cookie so backend knows who to clear
                        });
                    } catch (err) {
                        console.error('logout error:', err);
                    }

                    window.location.href = 'index.html';
                });
            }
        } else {
            // Not logged in: Ensure Sign In link is still displayed
            navAuthItem.innerHTML = `
        <a class="nav-link" href="signin.html">Sign In</a>
      `;
        }
    }

    // 3. Handle "Try it now" button on Home page
    // Please set button id="tryItNowBtn" in index.html
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
