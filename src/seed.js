import { clearAllContacts, createContact, getStats } from './contacts.js';
import { DB_PATH } from './db.js';

/**
 * 演示数据：清空后重新写入，保证可以反复执行（幂等）。
 * 覆盖收藏、多电话（含第 4 个溢出到「其他」列）、邮箱、微信、QQ、地址、其他类型。
 */
const CONTACTS = [
  {
    name: '张伟',
    company: '云帆科技有限公司',
    note: '技术总监，负责后端架构。',
    bookmarked: true,
    methods: [
      { type: 'phone', value: '13800138001', label: '手机', is_primary: true },
      { type: 'email', value: 'zhangwei@yunfan.example.com', label: '工作邮箱', is_primary: true },
      { type: 'wechat', value: 'zhangwei_dev', label: '微信' },
      { type: 'address', value: '杭州市余杭区文一西路 969 号', label: '公司地址' },
    ],
  },
  {
    name: '李娜',
    company: '蓝海设计工作室',
    note: '创始人，偏好微信沟通。',
    bookmarked: false,
    methods: [
      { type: 'phone', value: '13900139002', label: '手机', is_primary: true },
      { type: 'phone', value: '0571-88886666', label: '座机' },
      { type: 'email', value: 'lina@lanhai.example.com', label: '工作邮箱', is_primary: true },
      { type: 'wechat', value: 'lina_design', label: '微信' },
      { type: 'qq', value: '123456789', label: 'QQ' },
    ],
  },
  {
    name: '王强',
    company: '星河资本',
    note: '投资经理，周一上午通常有空。',
    bookmarked: true,
    methods: [
      { type: 'phone', value: '13700137003', label: '手机', is_primary: true },
      { type: 'email', value: 'wangqiang@xinghe.example.com', label: '工作邮箱', is_primary: true },
      { type: 'wechat', value: 'wq_invest', label: '微信' },
      { type: 'address', value: '上海市浦东新区世纪大道 100 号', label: '办公地址' },
    ],
  },
  {
    name: '陈静',
    company: '明德律师事务所',
    note: '合同相关事务联系人。',
    bookmarked: false,
    methods: [
      { type: 'phone', value: '13600136004', label: '手机', is_primary: true },
      { type: 'email', value: 'chenjing@mingde.example.com', label: '工作邮箱', is_primary: true },
      { type: 'wechat', value: 'chenjing_law', label: '微信' },
      { type: 'address', value: '北京市朝阳区建国路 88 号', label: '办公地址' },
    ],
  },
  {
    name: '刘洋',
    company: '自由职业',
    note: '摄影师，可约拍产品图。',
    bookmarked: false,
    methods: [
      { type: 'phone', value: '13500135005', label: '手机', is_primary: true },
      { type: 'email', value: 'liuyang.photo@example.com', label: '个人邮箱', is_primary: true },
      { type: 'wechat', value: 'liuyang_photo', label: '微信' },
      { type: 'qq', value: '987654321', label: 'QQ' },
      { type: 'address', value: '成都市武侯区科华北路 12 号', label: '常用地址' },
    ],
  },
  {
    name: '赵敏',
    company: '启明星教育',
    note: '课程顾问，合作对接人。',
    bookmarked: true,
    methods: [
      { type: 'phone', value: '13400134006', label: '手机', is_primary: true },
      { type: 'phone', value: '010-66668888', label: '座机' },
      { type: 'email', value: 'zhaomin@qmx.example.com', label: '工作邮箱', is_primary: true },
      { type: 'wechat', value: 'zhaomin_edu', label: '微信' },
    ],
  },
  {
    name: '孙磊',
    company: '拓界网络',
    note: '前端工程师，GitHub 上有开源项目。',
    bookmarked: false,
    methods: [
      { type: 'phone', value: '13300133007', label: '手机', is_primary: true },
      { type: 'email', value: 'sunlei@tuojie.example.com', label: '工作邮箱', is_primary: true },
      { type: 'wechat', value: 'sunlei_fe', label: '微信' },
      { type: 'qq', value: '456789123', label: 'QQ' },
      { type: 'other', value: 'https://github.com/sunlei-dev', label: 'GitHub' },
    ],
  },
  {
    name: '周婷',
    company: '青禾文化',
    note: '编辑，负责内容审核；有多个联系电话。',
    bookmarked: false,
    methods: [
      { type: 'phone', value: '13200132008', label: '手机', is_primary: true },
      { type: 'phone', value: '13100131009', label: '备用手机' },
      { type: 'phone', value: '13000130010', label: '家庭电话' },
      { type: 'phone', value: '025-88889999', label: '座机' },
      { type: 'email', value: 'zhouting@qinghe.example.com', label: '工作邮箱', is_primary: true },
      { type: 'wechat', value: 'zhouting_edit', label: '微信' },
      { type: 'address', value: '南京市鼓楼区广州路 20 号', label: '办公地址' },
    ],
  },
];

try {
  clearAllContacts();
  for (const contact of CONTACTS) {
    createContact(contact);
  }
  const stats = getStats();
  console.log(`已清空并写入 ${stats.contacts} 条演示联系人。`);
  console.log(`收藏：${stats.bookmarked} 位，联系方式：${stats.methods} 条。`);
  console.log(`分类统计：${JSON.stringify(stats.byType)}`);
  console.log(`数据库文件：${DB_PATH}`);
} catch (error) {
  console.error('[seed] 写入演示数据失败：', error);
  process.exitCode = 1;
}
