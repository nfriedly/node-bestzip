const tests = [
  {cwd: 'test/fixtures/', args: ['*']},
  {cwd: 'test/', args: ['/fixtures/*']},
  {cwd: 'test/', args: ['fixtures/']},
  {cwd: 'test/fixtures', args: ['obama.jpg']},
  {cwd: 'test/fixtures', args: ['obama.jpg']},
];