// ============================================================
// CLI 入口
// 对应 spec 06-cli-interface → 命令结构
//
// 职责：
// 1. 注册所有子命令（index:build, analyze, config:show 等）
// 2. 解析全局选项（--target, --verbose 等）
// 3. 统一的错误处理和输出格式
// ============================================================

import { Command } from 'commander';
import chalk from 'chalk';
import { loadTargetConfig } from './config/loader.js';
import { ConfigError } from './config/errors.js';

const program = new Command();

// ============================================================
// 全局元信息
// ============================================================

program
  .name('code-sherpa')
  .description('智能代码治理 Agent——面向大型 TypeScript monorepo 的符号依赖分析工具')
  .version('0.1.0');

// ============================================================
// config:show — 查看当前配置
// ============================================================

program
  .command('config:show')
  .description('查看当前目标代码库的解析后配置')
  .option('-t, --target <name>', '目标代码库名称', 'lpgj')
  .action((options: { target: string }) => {
    try {
      const config = loadTargetConfig(options.target);

      console.log(chalk.bold('\n📋 Target Config\n'));
      console.log(chalk.gray('─'.repeat(60)));

      // 基本信息
      console.log(chalk.cyan('  name:       ') + config.name);
      console.log(chalk.cyan('  description:') + (config.description || chalk.gray('(none)')));
      console.log(chalk.cyan('  root:       ') + config.root);
      console.log(chalk.cyan('  read_only:  ') + chalk.green(String(config.readOnly)));

      // 路径映射
      console.log(chalk.gray('\n  ── paths ──'));
      if (Object.keys(config.paths).length === 0) {
        console.log(chalk.gray('    (none)'));
      } else {
        for (const [alias, absPath] of Object.entries(config.paths)) {
          console.log(chalk.cyan(`    ${alias}: `) + absPath);
        }
      }

      // 领域知识上下文
      console.log(chalk.gray('\n  ── context ──'));
      if (Object.keys(config.context).length === 0) {
        console.log(chalk.gray('    (none)'));
      } else {
        for (const [key, absPath] of Object.entries(config.context)) {
          console.log(chalk.cyan(`    ${key}: `) + absPath);
        }
      }

      // 索引配置
      console.log(chalk.gray('\n  ── index ──'));
      console.log(chalk.cyan('    include:      ') + config.index.include.join(', '));
      console.log(chalk.cyan('    exclude:      ') + config.index.exclude.join(', '));
      console.log(chalk.cyan('    max_file_lines:') + String(config.index.max_file_lines));

      console.log(chalk.gray('\n' + '─'.repeat(60) + '\n'));
    } catch (err) {
      if (err instanceof ConfigError) {
        console.error(chalk.red(`\n  [${err.name}] ${err.message}\n`));
      } else {
        console.error(chalk.red(`\n  [Error] ${err}\n`));
      }
      process.exit(1);
    }
  });

// ============================================================
// 解析
// ============================================================

program.parse();
