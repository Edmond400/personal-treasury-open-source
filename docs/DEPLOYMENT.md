# 独立部署

1. 登录自己的 Cloudflare 账号，创建独立 Worker 和 D1 数据库，将返回的 UUID 填入 wrangler 配置的 `database_id`；仓库中的 UUID 是占位符。
2. 在自己的 Cloudflare 账号配置加密秘密，不要将真实值提交到 Git。
3. 应用迁移、构建并部署；域名路由请按自己的域名配置。首次使用先在本地或测试环境核对。

```sh
npx wrangler@4 login
npx wrangler@4 d1 create personal-treasury-db
# 把返回的 UUID 填入 wrangler.jsonc 后继续：
npx wrangler@4 d1 migrations apply DB --remote
npx wrangler@4 secret put AUTH_PEPPER
npx wrangler@4 secret put SETUP_TOKEN
npm run build
npx wrangler@4 deploy
```

AUTH_PEPPER 需为自行生成的至少 32 字符随机值。SETUP_TOKEN 是首次创建管理员时输入的私密初始化码。两者应离线妥善保存；丢失 AUTH_PEPPER 会影响密码校验。生产环境不要配置 LOCAL_DEV。应用只记录账务，不执行实际资金操作。
