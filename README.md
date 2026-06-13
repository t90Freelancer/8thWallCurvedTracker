# Bia Hanoi Premium AR Image Target

Project này dùng 8th Wall Image Target để nhận diện ảnh mặt trước lon Bia Hanoi Premium và hiển thị effect quanh thân lon.

## Có gì trong project

- `image-targets/bia-hanoi-premium_*`: bộ ảnh target tạo từ `/Users/TuyenT90/Downloads/BiaHNNewTarget.png`.
- `image-targets/bia-hanoi-premium.json`: target data tên `bia-hanoi-premium`.
- `src/.expanse.json`: scene AR tối giản với camera, image target anchor và effect quanh lon.
- `src/bia-can-effect.ts`: component bật/tắt và animate effect khi target found/lost.
- `src/app.js`: chỉ load image target `bia-hanoi-premium` để tracking gọn hơn.

## Lưu ý về curved tracking

File target JSON hiện tại là placeholder planar để project build và mở được. Để tracking tốt trên lon thật, hãy import ảnh này vào 8th Wall Studio và generate lại target dạng curved/cylindrical nếu tài khoản Studio của bạn có tuỳ chọn đó. Giữ nguyên target name là:

```text
bia-hanoi-premium
```

Sau khi Studio generate target data, thay các file `image-targets/bia-hanoi-premium.*` bằng bộ file mới từ Studio, hoặc import lại project trong Studio rồi chọn target đó cho object `Bia Hanoi Premium Image Target`.

## Chạy local

Nếu máy có `npm`:

```bash
npm run serve
```

Trong môi trường shell hiện tại không có `npm` trên PATH, có thể chạy bằng Node bundle của Codex:

```bash
/Users/TuyenT90/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./node_modules/webpack-dev-server/bin/webpack-dev-server.js --mode=development --config config/webpack.config.js
```

Sau đó kết nối điện thoại theo hướng dẫn của 8th Wall Desktop App và scan ảnh/lon bia.

## Build

```bash
/Users/TuyenT90/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./node_modules/webpack/bin/webpack.js --config config/webpack.config.js
```
