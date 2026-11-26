<script>
export default {
  onLaunch() {
    console.log('邻里团 mobile launched')
  }
}
</script>

<style>
page {
  min-height: 100%;
  background:
    radial-gradient(circle at 10% 8%, rgba(255, 246, 232, .96), transparent 34%),
    radial-gradient(circle at 90% 12%, rgba(245, 177, 131, .86), transparent 32%),
    radial-gradient(circle at 70% 90%, rgba(219, 132, 101, .72), transparent 34%),
    linear-gradient(135deg, #f8e9d9, #f3d0b6 46%, #e8a98d);
  color: #2b1f1a;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
}
view, text, button, input { box-sizing: border-box; }
button::after { border: 0; }
.glass {
  background: rgba(255, 255, 255, .54);
  border: 1rpx solid rgba(255, 255, 255, .7);
  border-radius: 36rpx;
  box-shadow: 0 24rpx 60rpx rgba(96, 45, 24, .13);
  backdrop-filter: blur(20rpx);
}
.muted { color: #7d685e; }
.eyebrow { color: #c45b3c; font-size: 20rpx; font-weight: 700; letter-spacing: 3rpx; }
.pill { display: inline-flex; align-items: center; padding: 8rpx 16rpx; border-radius: 999rpx; background: rgba(196, 91, 60, .12); color: #a7462e; font-size: 20rpx; }
.page-pad { padding: 32rpx 28rpx 120rpx; }
</style>

