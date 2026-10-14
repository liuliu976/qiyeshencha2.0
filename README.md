# 合同审查工作台

AI 合同风险识别工具，基于扣子工作流实现智能合同审查。

## 功能特性

- **合同提交**：支持文件上传（TXT/MD）和文本粘贴
- **审查配置**：合同类型、审查立场、重点审查内容
- **智能审查**：调用扣子工作流进行合同分析，实时显示审查进度
- **结果展示**：风险分级（高/中/低）、问题分析、修改建议、法律引用核验
- **筛选与复制**：按风险等级筛选意见，支持单条/全部复制
- **历史记录**：自动保存审查记录到浏览器本地存储

## 快速开始

### 本地运行

```bash
# 1. 安装依赖
npm install

# 2. 复制并配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入你的扣子工作流配置

# 3. 启动服务
npm start

# 4. 访问页面
# 浏览器打开 http://localhost:3000
```

### 部署到 Vercel

1. Fork 或上传此仓库到 GitHub
2. 登录 [Vercel](https://vercel.com)，点击「New Project」
3. 导入你的 GitHub 仓库
4. 在 Vercel 项目设置中添加环境变量：
   - `COZE_PAT_TOKEN` — 你的扣子个人访问密钥
   - `COZE_WORKFLOW_ID` — 你的扣子工作流 ID
   - `COZE_API_BASE` — `https://api.coze.cn`
5. 点击 Deploy，等待部署完成
6. 访问 Vercel 分配的域名即可使用

> 注意：个人访问密钥仅保存在服务端环境变量中，不会暴露到浏览器端。

## 演示流程

1. 打开页面，在文本框粘贴合同内容（或上传 TXT/MD 文件）
2. 选择合同类型和审查立场
3. 点击「开始智能审查」
4. 查看审查结果，可筛选风险等级、复制修改建议

如果扣子工作流未配置或暂时无法连接，系统会自动使用演示数据。

## 技术架构

- **前端**：原生 HTML/CSS/JavaScript，无构建工具
- **后端**：Vercel Serverless Functions（生产）/ Express（本地开发）
- **数据存储**：localStorage（历史记录）

## 项目结构

```
├── api/
│   ├── review.js      # 审查 API（Vercel Serverless Function）
│   └── health.js      # 健康检查 API
├── public/
│   └── index.html     # 前端页面
├── server.js          # 本地开发服务器
├── vercel.json        # Vercel 部署配置
├── .env.example       # 环境变量模板
├── .gitignore
└── package.json
```