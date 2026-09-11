export const clientPageDefinitions = {
  admin: {
    basePath: '/admin',
    sections: [{ id: 'workspace', title: '工作区' }],
    pages: [
      {
        path: 'home',
        name: 'admin-home',
        title: '项目首页',
        sourceType: 'html-template',
        source: 'home.html',
        fileName: 'home.html',
        section: 'workspace',
        icon: 'DataBoard',
      },
      // <generator:admin-pages>
    ],
  },
};
