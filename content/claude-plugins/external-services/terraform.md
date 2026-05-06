# 6.7 Terraform

## 定位

HashiCorp 官方的 Terraform MCP 服务器，辅助 Infrastructure as Code 开发。查文档、校验配置、与 Terraform Cloud/Enterprise 交互。

## 核心功能

通过 Docker 容器运行的 stdio 类型 MCP 服务器（镜像 `hashicorp/terraform-mcp-server:0.4.0`）。

- Terraform provider 和 resource 文档查询
- HCL 配置校验
- Terraform Cloud/Enterprise workspace 管理
- Plan 和 Apply 操作的状态查看
- Module 搜索

## 安装与配置

```
/plugin install terraform@claude-plugins-official
```

前置条件：
1. **Docker**——插件通过 `docker run` 启动容器，没装 Docker 就用不了
2. **TFE_TOKEN**（可选）——如果要连 Terraform Cloud 或 Enterprise，需要设置这个环境变量：

```bash
export TFE_TOKEN="your-terraform-cloud-token"
```

不连 Terraform Cloud 的话，纯本地的文档查询和 HCL 校验不需要 token。

## 典型使用场景

**场景一：写 Terraform 配置时查文档**

"aws_lambda_function 这个 resource 有哪些参数，runtime 支持哪些值"——不用切到浏览器翻 Registry 文档。

**场景二：配置审查**

"帮我看看这个 main.tf 有没有问题"——Claude 可以结合 Terraform 知识和 MCP 提供的校验能力给出具体建议。

**场景三：Terraform Cloud 操作**

"帮我看一下 production workspace 最近一次 plan 的状态"，或者"列出所有 workspace 及其最后 apply 时间"。

## 注意事项

- Docker 必须安装且正在运行。容器镜像首次拉取需要下载时间。
- 版本锁定在 `0.4.0`，想升级需要手动改 `.mcp.json` 里的镜像 tag。
- TFE_TOKEN 的权限范围决定了对 Terraform Cloud 的操作能力。建议用 team token 而非 user token，权限更可控。
- 容器内没有你的本地文件系统访问权限。如果需要分析本地 `.tf` 文件，内容需要通过 Claude 传递过去，而非让 MCP 服务器直接读取。
