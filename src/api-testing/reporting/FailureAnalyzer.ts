import type { TestCase } from '../models/types.js';

export class FailureAnalyzer {
  /**
   * Generate fix suggestions for a failed test
   */
  public generateFixSuggestions(test: TestCase): string {
    let suggestions = '';

    if (test.errorMessage) {
      const error = test.errorMessage.toLowerCase();
      
      if (error.includes('timeout') || error.includes('timed out')) {
        suggestions += '- Check if the API endpoint is responsive\n';
        suggestions += '- Consider increasing the timeout value\n';
        suggestions += '- Verify network connectivity\n';
      } else if (error.includes('401') || error.includes('unauthorized')) {
        suggestions += '- Verify authentication credentials are correct\n';
        suggestions += '- Check if the API token has expired\n';
        suggestions += '- Ensure proper authorization headers are set\n';
      } else if (error.includes('404') || error.includes('not found')) {
        suggestions += '- Verify the endpoint URL is correct\n';
        suggestions += '- Check if the resource exists\n';
        suggestions += '- Ensure the base URL is properly configured\n';
      } else if (error.includes('500') || error.includes('internal server error')) {
        suggestions += '- Check server logs for detailed error information\n';
        suggestions += '- Verify the request payload is valid\n';
        suggestions += '- Contact the API provider if the issue persists\n';
      } else if (error.includes('400') || error.includes('bad request')) {
        suggestions += '- Verify the request body format is correct\n';
        suggestions += '- Check if all required fields are provided\n';
        suggestions += '- Validate data types match the API specification\n';
      } else {
        suggestions += '- Review the error message for specific details\n';
        suggestions += '- Check API documentation for requirements\n';
        suggestions += '- Verify the test configuration is correct\n';
      }
    } else {
      suggestions += '- Review test logs for more information\n';
      suggestions += '- Verify the test expectations are correct\n';
    }

    return suggestions;
  }
}
