# 透明物理幕布

当前版本：`v2026.06.02-r84`

基于 p5.js 和 MediaPipe Hands 的实时摄像头互动页面，支持透明幕布、磨砂玻璃、绿幕 reveal、单手握拳移动、双手缩放，以及手机浏览器访问。

## 本地预览

```bash
python3 -m http.server 4173 --bind 0.0.0.0
```

电脑上打开：

```text
http://localhost:4173
```

手机预览需要与电脑在同一个 Wi-Fi 下访问电脑局域网 IP。完整摄像头和手势能力建议使用 HTTPS 页面，例如 Netlify 部署地址。

## Netlify 自动部署

项目已包含 `netlify.toml`。发布到 GitHub 后，在 Netlify 中导入该仓库，选择：

- Build command: 留空
- Publish directory: `.`

之后每次 push 到 GitHub 默认分支，Netlify 会自动重新部署。
