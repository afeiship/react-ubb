# react-ubb
> Lightweight React editor for plain text with simple formatting tags.

[![version][version-image]][version-url]
[![license][license-image]][license-url]
[![download][download-image]][download-url]

## installation
```shell
npm install -S @jswork/react-ubb
```

## usage
  ```js
  import ReactUbb from '@jswork/react-ubb';
  import '@jswork/react-ubb/dist/style.scss';

  function App() {
    return (
      <div className="m-10 p-4 shadow bg-gray-100 text-gray-800 hover:shadow-md transition-all">
        <div className="badge badge-warning absolute right-0 top-0 m-4">
          Build Time: {BUILD_TIME}
        </div>
        <ReactUbb className="debug-red">
          abc
        </ReactUbb>
      </div>
    );
  }

  export default App;
  ```

## preview
- https://afeiship.github.io/react-ubb/

## license
Code released under [the MIT license](https://github.com/afeiship/react-ubb/blob/master/LICENSE.txt).

[version-image]: https://img.shields.io/npm/v/@jswork/react-ubb
[version-url]: https://npmjs.org/package/@jswork/react-ubb

[license-image]: https://img.shields.io/npm/l/@jswork/react-ubb
[license-url]: https://github.com/afeiship/react-ubb/blob/master/LICENSE.txt

[download-image]: https://img.shields.io/npm/dm/@jswork/react-ubb
[download-url]: https://www.npmjs.com/package/@jswork/react-ubb
