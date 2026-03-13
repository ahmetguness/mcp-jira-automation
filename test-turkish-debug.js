// Quick debug script to test Turkish detection
import { DefaultLanguageDetector } from './dist/test-execution-reporting/language-detector.js';

const detector = new DefaultLanguageDetector();

// Test case from the failing counterexample
const turkishChars = ["İ","ğ","İ","ğ","İ","ğ"];
const englishWords = ["error"];
const content = [...turkishChars, ...englishWords].join(' ');

console.log('Content:', content);
console.log('Result:', detector.detect(content));
console.log('Expected: tr');
