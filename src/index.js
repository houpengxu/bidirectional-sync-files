#!/usr/bin/env node
const os = require('os');
const path = require('path');
const fse = require('fs-extra');
const chokidar = require('chokidar');

let config = null
const customPath = process.argv[2]
const userHomeConfig = os.homedir() + '/.bi-sync-files.json';
// 自定义路径
if (customPath && fse.pathExistsSync(customPath)) {
  config = require(customPath)
} else if (fse.pathExistsSync(userHomeConfig)) {
  // 用户主目录路径
  config = require(userHomeConfig)
} else {
  // 程序运行的相对路径
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

init();

function init() {

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


  // 检测文件或文件夹是否存在
  let allFileExist = true
  for (const item of config.syncs) {
    const { from, to, ignored } = item;
    // 注意点：不能自动创建，因为一旦可以自动创建了，新创建的文件就是最新的文件了，就会覆盖本来的文件。
    if (!fse.pathExistsSync(from)) {
      log(`path "${from}" does not exist.`)
      allFileExist = false
    }
    if (!fse.pathExistsSync(to)) {
      log(`path "${to}" does not exist.`)
      allFileExist = false
    }
  }
  if (allFileExist) {
    start()
  }
}


// 开始
function start() {
  // 监听源路径的文件或文件夹变化
  for (const item of config.syncs) {
    const { from, to, ignored } = item;
    chokidar.watch(from, {
      ignored: ignored
    }).on('all', async (event, path) => {
      log(`File ${path} has been ${event}.`);
      await sync(from, to, ignored);
    });
  }

  // 监听目标路径的文件或文件夹变化，需要等源路径的文件或文件夹变化执行结束
  const interval = setInterval(() => {
    for (const item of config.syncs) {
      const { from, to, ignored } = item;
      if (syncFileList.size == 0) {
        clearInterval(interval)
        chokidar.watch(to, {
          ignored: ignored
        }).on('all', async (event, path) => {
          log(`File ${path} has been ${event}.`);
          await sync(to, from, ignored);
        });
      }
    }
  }, intervalTime);

  // 定时同步
  setInterval(() => {
    if (syncFileList.size > 0) return
    for (const item of config.syncs) {
      const { from, to, ignored } = item;
      sync(from, to, ignored);
    }

    const interval = setInterval(() => {
      if (syncFileList.size > 0) return
      clearInterval(interval)
      for (const item of config.syncs) {
        const { from, to, ignored } = item;
        sync(to, from, ignored);
      }
    }, intervalTime);

  }, intervalSyncTime);
}


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
    log(`Source path "${fromPath}" does not exist.`);
    return;
  }
  if (!toExists) {
    log(`Destination path "${toPath}" does not exist.`);
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

function log(msg) {
  console.log(`${new Date().toISOString()}: ${msg}`)
}