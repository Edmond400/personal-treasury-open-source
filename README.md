# Personal Treasury

个人收支、账户分类、资产核算、债权债务、政策执行、备份恢复与月度复核。

这是 2026-11-24 整理的开源源码版本，采用 [MIT 许可证](LICENSE)。

## 本地运行

使用 Node.js 24 或更新版本。

```sh
git clone https://github.com/Edmond400/personal-treasury-open-source.git
cd personal-treasury-open-source
npm run check
npm test
npm run build
npm run dev
```

测试只使用本地生成的数据。Cloudflare 项目首次运行前需应用本地数据库迁移：`npx wrangler@4 d1 migrations apply DB --local`。

## 部署与数据

部署步骤见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。请创建自己的 Worker、D1 和需要的 R2 桶，并替换配置中的示例标识。仓库不提供有效密码、生产数据库、同学名单、财务记录、录音或用户上传的照片。





## 版本来源

本次快照的源提交：`517b33059c6971d51b38958c350da3652a32f20e`。公开仓库保留经过脱敏的功能代码与必要测试；生产运行记录与私有提交历史未纳入快照。公开源码和在线服务分别维护，后续版本需再次同步。

## 许可

原创代码使用 MIT。第三方依赖、字体和图片的许可独立适用；MIT 不授予大学名称、徽标、商标或站内用户内容的使用权。问题反馈请使用本仓库 Issues，勿附带密码、令牌或原始个人数据。
