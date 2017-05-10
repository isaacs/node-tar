# node-tar benchmarks

There are a bunch of benchmark scripts in `./benchmarks`.  These
compare the various ways to use node-tar, tar-fs, tar-stream, and the
fstream version of node-tar.

You can pass a filename to all the parse and extract benchmarks, and a
folder to the create benchmark.

```
$ time tar cf downloads.tar -C ~ Downloads

real	0m23.751s
user	0m0.630s
sys	0m11.743s

$ node benchmarks/create/old-async.js ~/Downloads
42272.452728 (42.3s)

$ node benchmarks/create/tar-fs-async.js ~/Downloads
25599.186971 (25.6s)

$ node benchmarks/create/node-tar-file-sync.js ~/Downloads
23677.560389 (23.7s)

$ node benchmarks/extract/old-async.js downloads.tar
214248.237973 (214.2s)

$ node benchmarks/extract/tar-fs-async.js downloads.tar
33976.501071 (34.0s)

$ node benchmarks/extract/node-tar-file-sync.js downloads.tar
17254.956028 (17.3s)
```

To run a bunch of benchmarks, type `npm run bench`.

```
$ npm run bench

> tar@2.2.1 bench /Users/isaacs/dev/js/tar
> for i in benchmarks/*/*.js; do echo $i; for j in {1..5}; do node $i || break; done; done

benchmarks/create/node-tar-file-async.js
118.153
124.152
117.554
111.221
108.186
benchmarks/create/node-tar-file-sync.js
93.476
93.019
99.313
94.475
89.388
benchmarks/create/node-tar-stream-async.js
109.041
109.456
122.198
108.559
108.101
benchmarks/create/node-tar-stream-sync.js
95.449
100.572
122.602
94.681
95.732
benchmarks/create/old-async.js
285.111
254.173
255.68
270.314
322.798
benchmarks/create/pack-async.js
129.29
134.56
98.538
108.607
120.551
benchmarks/create/pack-sync.js
100.473
98.25
98.448
96.355
93.235
benchmarks/create/tar-fs-async.js
166.825
205.416
168.769
172.992
189.854
benchmarks/extract/node-tar-file-async.js
1228.391 (1.2s)
985.846
1072.73 (1.1s)
859.067
881.437
benchmarks/extract/node-tar-file-sync.js
1215.858 (1.2s)
1086.313 (1.1s)
1132.42 (1.1s)
1076.573 (1.1s)
1188.361 (1.2s)
benchmarks/extract/node-tar-stream-async.js
1035.188
1061.6 (1.1s)
956.506
1103.758 (1.1s)
1186.414 (1.2s)
benchmarks/extract/node-tar-stream-sync.js
1282.724 (1.3s)
1470.698 (1.5s)
1080.566 (1.1s)
1351.072 (1.4s)
1149.005 (1.1s)
benchmarks/extract/old-async.js
2697.997 (2.7s)
2638.7 (2.6s)
2676.483 (2.7s)
2456.808 (2.5s)
2632.987 (2.6s)
benchmarks/extract/old-sync.js
2630.631 (2.6s)
3348.535 (3.3s)
2804.793 (2.8s)
2683.767 (2.7s)
2429.574 (2.4s)
benchmarks/extract/tar-fs-async.js
3476.535 (3.5s)
3295.247 (3.3s)
3649.666 (3.6s)
2990.234 (3s)
3080.088 (3.1s)
benchmarks/extract/tar-fs-sync.js
2912.93 (2.9s)
2906.809 (2.9s)
2895.982 (2.9s)
2788.321 (2.8s)
2763.063 (2.8s)
benchmarks/extract/unpack-async.js
917.924
996.596
980.011
959.166
912.224
benchmarks/extract/unpack-sync.js
1086.979 (1.1s)
1003.369
1007.736
1014.644
965.837
benchmarks/parse/fast-scan-no-body.js
97.161
96.942
92.594
83.1
83.687
benchmarks/parse/fast-scan.js
103.901
99.561
110.304
121.186
108.992
benchmarks/parse/node-tar-file-async.js
142.502
140.748
150.195
139.453
138.621
benchmarks/parse/node-tar-file-sync.js
127.851
125.472
126.201
128.51
125.533
benchmarks/parse/node-tar-stream-async.js
143.174
155.308
148.667
143.529
150.993
benchmarks/parse/node-tar-stream-sync.js
142.549
141.47
135.668
133.812
126.849
benchmarks/parse/old-async.js
170.105
146.608
148.354
155.255
175.018
benchmarks/parse/old-sync.js
126.975
125.584
126.011
128.157
126.623
benchmarks/parse/parse-async.js
164.151
145.304
160.246
148.458
224.993
benchmarks/parse/parse-sync.js
125.92
142.842
115.224
116.128
119.958
benchmarks/parse/tar-stream-async.js
157.796
143.333
143.042
149.831
147.184
benchmarks/parse/tar-stream-sync.js
126.07
120.343
125.797
116.791
126.587
```
