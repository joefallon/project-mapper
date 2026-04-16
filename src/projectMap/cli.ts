import path from 'path';
import { fileURLToPath } from 'node:url';
import { getPaths } from './constants';
import { runBuild } from './build/collect';
import { runStats, runFind, runInspect, runPack } from './commands';

export function printHelp(projectRoot?: string) {
    const paths = getPaths(projectRoot);
    const scriptPath = path.relative(paths.PROJECT_ROOT, fileURLToPath(import.meta.url)) || '.ai/scale/project-map.mjs';

    console.log('ProjectMap v1');
    console.log('');
    console.log('Usage:');
    console.log(`  node ${scriptPath} <command> [args]`);
    console.log('');
    console.log('Commands:');
    console.log('  build');
    console.log('    Rebuilds .ai/scale/state from scratch.');
    console.log('  stats');
    console.log('    Prints a compact high-level project summary.');
    console.log('  find "<query>"');
    console.log('    Prints ranked candidate files and chunks for a query.');
    console.log('  inspect "<path-or-id>"');
    console.log('    Prints structured details for one file or chunk.');
    console.log('  pack "<task-or-question>"');
    console.log('    Prints a compact investigation packet optimized for browser-based work.');
    console.log('  help');
    console.log('    Prints this help text.');
    console.log('');
    console.log('Examples:');
    console.log(`  node ${scriptPath} build`);
    console.log(`  node ${scriptPath} stats`);
    console.log(`  node ${scriptPath} find "sales order rate retrieval"`);
    console.log(`  node ${scriptPath} inspect "application/controllers/QbeSalesOrderViewController.php"`);
    console.log(`  node ${scriptPath} pack "Where does sales order rate retrieval happen?"`);
}

export async function main(argv?: string[], projectRoot?: string) {
    const args = argv ?? process.argv.slice(2);
    const [command, ...rest] = args;

    switch(command) {
        case 'build':
            if(rest.length > 0) {
                throw new Error('The build command does not accept additional arguments.');
            }
            await runBuild(projectRoot);
            break;

        case 'stats':
            if(rest.length > 0) {
                throw new Error('The stats command does not accept additional arguments.');
            }
            await runStats(projectRoot);
            break;

        case 'find': {
            const queryText = rest.join(' ').trim();
            if(!queryText) {
                throw new Error('The find command requires a query string.');
            }
            await runFind(queryText, projectRoot);
            break;
        }

        case 'inspect': {
            const target = rest.join(' ').trim();
            if(!target) {
                throw new Error('The inspect command requires a path or id.');
            }
            await runInspect(target, projectRoot);
            break;
        }

        case 'pack': {
            const queryText = rest.join(' ').trim();
            if(!queryText) {
                throw new Error('The pack command requires a task or question.');
            }
            await runPack(queryText, projectRoot);
            break;
        }

        case 'help':
        case '--help':
        case '-h':
        case undefined:
            printHelp(projectRoot);
            break;

        default:
            throw new Error(`Unknown command: ${command}`);
    }
}

// top-level error handling when run as script
main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
});

