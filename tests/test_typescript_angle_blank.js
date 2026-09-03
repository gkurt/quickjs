// Angle-bracket type assertions (`<T>expr`) and type-only namespaces. They
// are valid TypeScript but Node's type stripping rejects them, so they are
// kept out of test_typescript.ts, which is also run under Node. The bytecode of this
// file must match test_typescript_angle_blank.js (see test_ts_bytecode.js).
import { assert } from "./assert.js";

let n         = 1;
let asserted =                  "7";
assert(asserted, "7");
const olit = { b:         2 };
assert(olit.b, 2);
let expr         = (n          ) +         n + n ;
assert(expr, 3);
let chain = { a: { b: [1] } };
assert((                        chain).a.b.length, 1);
        n;
assert(-        n, -1);
assert(        n +         n, 2);
const arr =                [1, 2];
assert(arr.length, 2);
const fn =                        ((x        ) => x + 1);
assert(fn(1), 2);

                                              
                    
                           
                               
               
                  
                                   
                               
                                                      
                       
     
 
                                            
                                                  
                                                  
