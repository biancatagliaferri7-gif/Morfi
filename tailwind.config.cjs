// tailwind.config.cjs
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        darkGreen: '#173D2B',
        lime: '#B9E769',
        primary: '#173D2B',
        background: '#FFFFFF'
      }
    }
  },
  plugins: []
};
