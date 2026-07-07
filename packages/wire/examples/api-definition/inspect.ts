import { notesApi } from './contract';

console.log('procedures:', Object.keys(notesApi.procedures));
console.log('live models:', Object.keys(notesApi.models));
console.log('live logs:', Object.keys(notesApi.logs));
