#!/usr/bin/env node
const os = require('os');
const path = require('path');
const fse = require('fs-extra');
const chokidar = require('chokidar');

const userHomeConfig = os.homedir() + '/.bi-sync-files.json';

let config = null
if (fse.pathExistsSync(userHomeConfig)) {
  config = require(userHomeConfig)
} else {
  console.log('请在用户目录设置.bi-sync-files.json')
  config = require('./config.json')
}

// 同步中的文件列表
const syncFileList = new Set()
// 锁定同步中的文件时长(毫秒)
const lockSyncTime = 1000
// 循环检测启动程序后第一次源路径的文件或文件夹变化执行完毕间隔(毫秒)
const intervalTime = 1000 * 5
// 定时同步时间间隔(毫秒)
const intervalSyncTime = 1000 * 60 * 60

// 根据相对路径获取出绝对路径
config.syncs = config.syncs.map(item => {
  if (item.from.startsWith('../') || item.from.startsWith('./')) {
    item.from = path.resolve(item.from)
  }
  if (item.to.startsWith('../') || item.to.startsWith('./')) {
    item.to = path.resolve(item.to)
  }
  return item
})

// 遍历配置文件中的同步任务
for (const item of config.syncs) {
  const { from, to, ignored, type } = item;
  // 检测文件或文件夹是否存在，不存在则创建
  if (type == 'dir') {
    fse.ensureDir(from)
    fse.ensureDir(to)
  } else {
    fse.ensureFile(from)
    fse.ensureFile(to)
  }
}

// 监听源路径的文件或文件夹变化
for (const item of config.syncs) {
  const { from, to, ignored, type } = item;
  chokidar.watch(from, {
    ignored: ignored
  }).on('all', async (event, path) => {
    console.log(`File ${path} has been ${event}.`);
    await sync(from, to, ignored);
  });
}

// 监听目标路径的文件或文件夹变化，需要等源路径的文件或文件夹变化执行结束
const interval = setInterval(() => {
  for (const item of config.syncs) {
    const { from, to, ignored, type } = item;
    if (syncFileList.size == 0) {
      clearInterval(interval)
      chokidar.watch(to, {
        ignored: ignored
      }).on('all', async (event, path) => {
        console.log(`File ${path} has been ${event}.`);
        await sync(to, from, ignored);
      });
    }
  }
}, intervalTime);

// 定时同步
setInterval(() => {
  if (syncFileList.size > 0) return
  for (const item of config.syncs) {
    const { from, to, ignored, type } = item;
    sync(from, to, ignored);
  }

  const interval = setInterval(() => {
    if (syncFileList.size > 0) return
    clearInterval(interval)
    for (const item of config.syncs) {
      const { from, to, ignored, type } = item;
      sync(to, from, ignored);
    }
  }, intervalTime);

}, intervalSyncTime);

// 同步
async function sync(fromPath, toPath, ignored = []) {
  if (syncFileList.has(fromPath) || syncFileList.has(toPath)) {
    return
  }
  syncFileList.add(fromPath)
  syncFileList.add(toPath)
  // 判断源路径和目标路径是否存在
  const fromExists = await fse.pathExists(fromPath);
  const toExists = await fse.pathExists(toPath);
  if (!fromExists) {
    console.error(`Source path "${fromPath}" does not exist.`);
    return;
  }
  if (!toExists) {
    console.error(`Destination path "${toPath}" does not exist.`);
    return;
  }

  if (await compareFileTime(fromPath, toPath)) {
    // 拷贝源路径到目标路径
    await fse.copy(fromPath, toPath, {
      overwrite: true,
      filter: (src, dest) => {
        // 忽略指定的文件或文件夹
        for (const ignore of ignored) {
          if (src.includes(ignore)) {
            return false;
          }
        }
        return true;
      }
    });
  }
  setTimeout(() => {
    syncFileList.delete(fromPath)
    syncFileList.delete(toPath)
  }, lockSyncTime);
}

// 比较两个文件的修改时间
async function compareFileTime(path1, path2) {
  const stat1 = await fse.stat(path1);
  const stat2 = await fse.stat(path2);
  // 返回 true 表示第一个文件的修改时间晚于第二个文件的修改时间
  return stat1.mtime > stat2.mtime;
}



