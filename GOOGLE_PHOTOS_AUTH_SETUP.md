# Google Photos 登录配置指南

## 概述
VintageVision 现在支持通过 Google Photos 登录，用户可以使用他们的 Google 账户快速登录并访问他们的照片库。

## 配置步骤

### 1. 创建 Google Cloud 项目
1. 访问 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建新项目或选择现有项目
3. 启用以下 API：
   - Google+ API
   - Google Photos Library API

### 2. 配置 OAuth 2.0 客户端
1. 在 Google Cloud Console 中，转到 "APIs & Services" > "Credentials"
2. 点击 "Create Credentials" > "OAuth 2.0 Client IDs"
3. 选择 "Web application"
4. 添加授权重定向 URI：
   - 开发环境：`http://localhost:3000/api/auth/google/callback`
   - 生产环境：`https://yourdomain.com/api/auth/google/callback`

### 3. 环境变量配置
在 `backend/config.env.example` 文件中添加以下配置：

```env
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

### 4. 安装依赖
在 backend 目录中运行：
```bash
npm install googleapis passport passport-google-oauth20
```

## 功能特性

### 用户权限
- **基本资料访问**：获取用户的姓名、邮箱和头像
- **Google Photos 访问**：读取用户的照片库（只读权限）

### 登录流程
1. 用户点击 "使用 Google Photos 登录" 按钮
2. 弹出 Google OAuth 授权窗口
3. 用户授权后，系统自动创建或更新用户账户
4. 用户被重定向到仪表板页面

### 安全特性
- JWT 令牌认证
- 安全的 OAuth 2.0 流程
- 用户数据加密存储
- 支持现有用户账户关联

## 技术实现

### 后端 API 端点
- `GET /api/auth/google` - 获取 Google OAuth 授权 URL
- `GET /api/auth/google/callback` - OAuth 回调重定向
- `POST /api/auth/google/callback` - 处理授权码并创建用户会话

### 前端组件
- Google 登录按钮集成
- 弹窗 OAuth 流程
- 自动用户会话管理

## 故障排除

### 常见问题
1. **"Invalid client" 错误**：检查 GOOGLE_CLIENT_ID 是否正确
2. **"Redirect URI mismatch" 错误**：确保重定向 URI 在 Google Console 中正确配置
3. **"Access denied" 错误**：用户拒绝了授权请求

### 调试建议
- 检查浏览器控制台错误信息
- 验证环境变量是否正确设置
- 确认 Google Cloud 项目中的 API 已启用

## 生产环境部署
1. 更新重定向 URI 为生产域名
2. 设置正确的环境变量
3. 确保 HTTPS 配置正确
4. 测试完整的 OAuth 流程
