#!/bin/bash

# Run npm test and save the output to test-results.txt
npm test > test-results.txt

# Notify the user
echo 'Test results saved to test-results.txt'