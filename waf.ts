import type { WafRule } from './server-types';

export type { WafRule };

/**
 * Common WAF rules targeting script kiddie scanners, WordPress probes,
 * PHP exploits, web shells, and other known-bad path patterns.
 *
 * Use as a base when building custom rulesets:
 * @example
 * wafOverrides: [...WAF_COMMON_RULES, { pattern: '/my-secret', description: 'custom block' }]
 */
export const WAF_COMMON_RULES: readonly WafRule[] = [
	// WordPress
	{ pattern: '/wp-admin', description: 'WordPress admin panel probe' },
	{ pattern: '/wp-login.php', description: 'WordPress login probe' },
	{ pattern: '/wp-content', description: 'WordPress content directory probe' },
	{ pattern: '/wp-includes', description: 'WordPress includes directory probe' },
	{ pattern: '/wp-config.php', description: 'WordPress config file probe' },
	{ pattern: '/wp-cron.php', description: 'WordPress cron probe' },
	{ pattern: '/xmlrpc.php', description: 'WordPress XML-RPC probe' },

	// PHP / admin panels
	{ pattern: '/phpmyadmin', description: 'phpMyAdmin probe' },
	{ pattern: '/pma', description: 'phpMyAdmin shorthand probe' },
	{ pattern: '/phpinfo.php', description: 'PHP info disclosure probe' },
	{ pattern: '/php-info.php', description: 'PHP info disclosure probe' },
	{ pattern: '/info.php', description: 'PHP info disclosure probe' },
	{ pattern: '/config.php', description: 'PHP config file probe' },
	{ pattern: '/configuration.php', description: 'PHP config file probe' },
	{ pattern: '/database.php', description: 'PHP database file probe' },
	{ pattern: '/db.php', description: 'PHP database file probe' },
	{ pattern: '/setup.php', description: 'PHP setup file probe' },
	{ pattern: '/install.php', description: 'PHP install file probe' },
	{ pattern: '/upgrade.php', description: 'PHP upgrade file probe' },

	// Web shells
	{ pattern: '/shell.php', description: 'web shell probe' },
	{ pattern: '/cmd.php', description: 'web shell probe' },
	{ pattern: '/c99.php', description: 'c99 web shell probe' },
	{ pattern: '/r57.php', description: 'r57 web shell probe' },
	{ pattern: '/b374k', description: 'b374k web shell probe' },
	{ pattern: '/wso.php', description: 'WSO web shell probe' },
	{ pattern: '/alfa.php', description: 'Alfa web shell probe' },
	{ pattern: '/indoxploit.php', description: 'IndoXploit web shell probe' },
	{ pattern: '/webshell.php', description: 'web shell probe' },

	// Sensitive dotfiles and directories
	{ pattern: '/.env', description: 'environment file probe' },
	{ pattern: '/.git', description: 'git repository probe' },
	{ pattern: '/.htaccess', description: 'Apache htaccess probe' },
	{ pattern: '/.htpasswd', description: 'Apache htpasswd probe' },
	{ pattern: '/.ssh', description: 'SSH directory probe' },
	{ pattern: '/.aws', description: 'AWS credentials probe' },
	{ pattern: '/.npmrc', description: 'npm config probe' },
	{ pattern: '/.DS_Store', description: 'macOS metadata probe' },

	// Java / JVM stack probes
	{ pattern: '/actuator', description: 'Spring Boot actuator probe' },
	{ pattern: '/jolokia', description: 'Jolokia JMX probe' },
	{ pattern: '/jmx-console', description: 'JBoss JMX console probe' },
	{ pattern: '/invoker/JMXInvokerServlet', description: 'JBoss invoker probe' },
	{ pattern: '/manager/html', description: 'Tomcat manager probe' },
	{ pattern: '/manager/text', description: 'Tomcat manager probe' },

	// Common services probed by scanners
	{ pattern: '/solr/', description: 'Apache Solr probe' },
	{ pattern: '/jenkins', description: 'Jenkins CI probe' },
	{ pattern: '/hudson', description: 'Hudson CI probe' },

	// CMS probes
	{ pattern: '/administrator/', description: 'Joomla admin probe' },

	// CGI
	{ pattern: '/cgi-bin', description: 'CGI bin probe' },

	// Path traversal / system file probes
	{ pattern: '/etc/passwd', description: 'system file traversal probe' },
	{ pattern: '/proc/self', description: 'process info probe' },

	// Any .php file (catch-all for PHP probes not listed above)
	{ pattern: /\.php(\?|\/|$)/i, description: 'PHP file probe' },

	// Backup and dump file extensions
	{ pattern: /\.(bak|backup|old|orig|sql|dump)(\?|\/|$)/i, description: 'backup/dump file probe' },
];

/**
 * Returns true if the given pathname matches any WAF rule.
 * String patterns use case-insensitive prefix matching.
 * RegExp patterns are tested against the lowercased pathname.
 */
export function matchesWafRule(pathname: string, rules: readonly WafRule[]): boolean {
	const lower = pathname.toLowerCase();
	return rules.some((rule) => {
		if (rule.pattern instanceof RegExp) {
			return rule.pattern.test(lower);
		}
		return lower.startsWith(rule.pattern.toLowerCase());
	});
}
